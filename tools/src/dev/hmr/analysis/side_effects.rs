//! Decides whether a `.ts` / `.svelte.ts` module can be re-imported by the dev HMR without breaking
//! the running page. Re-evaluating a module runs its top level again, so a module whose top level
//! registers listeners, timers, observers or messaging channels, awaits, or writes to a global would
//! double them up: it stays on the reload path. This is the one place the rules live.

use std::fmt;
use std::path::Path;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    ArrowFunctionExpression, AssignmentExpression, AwaitExpression, CallExpression, Class,
    Expression, ForOfStatement, Function, MemberExpression, NewExpression,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::{ParseOptions, Parser};
use oxc_span::SourceType;
use oxc_syntax::scope::ScopeFlags;
use regex::Regex;

use crate::dev::hmr::error::Result;

const EVENT_LISTENER_METHOD: &str = "addEventListener";
const ADD_LISTENER_METHOD: &str = "addListener";
const MUTATION_OBSERVER: &str = "MutationObserver";
const EXTENSION_EVENT_NAME: &str = "^on[A-Z]";
const GLOBAL_OBJECTS: [&str; 4] = ["globalThis", "window", "self", "document"];

/// A top-level pattern that makes re-evaluating a module unsafe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SideEffectRule {
    EventListener,
    ExtensionListener,
    Interval,
    MutationObserver,
    CustomEventMessaging,
    WindowMessaging,
    TopLevelAwait,
    GlobalWrite,
}

impl fmt::Display for SideEffectRule {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::EventListener => EVENT_LISTENER_METHOD,
            Self::ExtensionListener => "browser.*.onX.addListener",
            Self::Interval => "setInterval",
            Self::MutationObserver => MUTATION_OBSERVER,
            Self::CustomEventMessaging => "defineCustomEventMessaging",
            Self::WindowMessaging => "defineWindowMessaging",
            Self::TopLevelAwait => "top-level await",
            Self::GlobalWrite => "write to a global",
        })
    }
}

/// The first top-level side effect of a module.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SideEffect {
    pub(crate) rule: SideEffectRule,
    pub(crate) line: usize,
}

fn rule_of_function_name(name: &str) -> Option<SideEffectRule> {
    match name {
        "setInterval" => Some(SideEffectRule::Interval),
        "defineCustomEventMessaging" => Some(SideEffectRule::CustomEventMessaging),
        "defineWindowMessaging" => Some(SideEffectRule::WindowMessaging),
        _ => None,
    }
}

fn member_of<'tree, 'src>(
    expression: &'tree Expression<'src>,
) -> Option<&'tree MemberExpression<'src>> {
    expression.as_member_expression()
}

/// The name a member access reaches for: `a.b` and `a[b]` both say `b`, a literal key says nothing.
fn member_property_name<'src>(member: &MemberExpression<'src>) -> Option<&'src str> {
    match member {
        MemberExpression::StaticMemberExpression(access) => Some(access.property.name.as_str()),
        MemberExpression::PrivateFieldExpression(access) => Some(access.field.name.as_str()),
        MemberExpression::ComputedMemberExpression(access) => match &access.expression {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            _ => None,
        },
    }
}

fn root_object_name<'src>(member: &MemberExpression<'src>) -> Option<&'src str> {
    let mut current = member.object();
    while let Some(inner) = member_of(current) {
        current = inner.object();
    }
    match current {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

struct Finder {
    extension_event: Regex,
    found: Option<(SideEffectRule, u32)>,
}

impl Finder {
    fn record(&mut self, rule: SideEffectRule, start: u32) {
        if self.found.is_none() {
            self.found = Some((rule, start));
        }
    }

    fn rule_of_call(&self, callee: &Expression<'_>) -> Option<SideEffectRule> {
        if let Expression::Identifier(identifier) = callee {
            return rule_of_function_name(identifier.name.as_str());
        }
        let member = member_of(callee)?;
        let method = member_property_name(member)?;
        let is_event_listener_call = method == EVENT_LISTENER_METHOD;
        if is_event_listener_call {
            return Some(SideEffectRule::EventListener);
        }
        let event_name = member_of(member.object())
            .and_then(member_property_name)
            .unwrap_or_default();
        let is_extension_listener =
            method == ADD_LISTENER_METHOD && self.extension_event.is_match(event_name);
        is_extension_listener.then_some(SideEffectRule::ExtensionListener)
    }
}

impl<'src> Visit<'src> for Finder {
    fn visit_function(&mut self, _function: &Function<'src>, _flags: ScopeFlags) {}

    fn visit_arrow_function_expression(&mut self, _arrow: &ArrowFunctionExpression<'src>) {}

    fn visit_class(&mut self, _class: &Class<'src>) {}

    fn visit_await_expression(&mut self, expression: &AwaitExpression<'src>) {
        self.record(SideEffectRule::TopLevelAwait, expression.span.start);
        walk::walk_await_expression(self, expression);
    }

    fn visit_for_of_statement(&mut self, statement: &ForOfStatement<'src>) {
        if statement.r#await {
            self.record(SideEffectRule::TopLevelAwait, statement.span.start);
        }
        walk::walk_for_of_statement(self, statement);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'src>) {
        if self.found.is_some() {
            return;
        }
        if let Some(rule) = self.rule_of_call(&call.callee) {
            self.record(rule, call.span.start);
            return;
        }
        match &call.callee {
            Expression::FunctionExpression(function) => {
                if let Some(body) = &function.body {
                    self.visit_function_body(body);
                }
            }
            Expression::ArrowFunctionExpression(arrow) => {
                self.visit_arrow_function_body(&arrow.body);
            }
            _ => {
                walk::walk_call_expression(self, call);
                return;
            }
        }
        self.visit_arguments(&call.arguments);
    }

    fn visit_new_expression(&mut self, expression: &NewExpression<'src>) {
        let is_observer = matches!(&expression.callee, Expression::Identifier(identifier) if identifier.name == MUTATION_OBSERVER);
        if is_observer {
            self.record(SideEffectRule::MutationObserver, expression.span.start);
        }
        walk::walk_new_expression(self, expression);
    }

    fn visit_assignment_expression(&mut self, assignment: &AssignmentExpression<'src>) {
        let target = assignment.left.as_member_expression();
        let is_global_write = target.is_some_and(|member| {
            member_property_name(member).is_some()
                && root_object_name(member).is_some_and(|root| GLOBAL_OBJECTS.contains(&root))
        });
        if is_global_write {
            self.record(SideEffectRule::GlobalWrite, assignment.span.start);
        }
        walk::walk_assignment_expression(self, assignment);
    }
}

fn line_of(source: &str, offset: usize) -> usize {
    source
        .bytes()
        .take(offset)
        .filter(|byte| *byte == b'\n')
        .count()
        + 1
}

fn source_type_of(filename: &str) -> SourceType {
    let is_javascript = Path::new(filename)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("js"));
    let base = if is_javascript {
        SourceType::mjs()
    } else {
        SourceType::ts()
    };
    base.with_module(true)
}

/// The first top-level side effect of a module, or `None` when re-evaluating it is safe. A module
/// that does not parse is reported as `Err` with the parser's first message line.
pub(crate) fn find_side_effect(
    source: &str,
    filename: &str,
) -> Result<std::result::Result<Option<SideEffect>, String>> {
    let allocator = Allocator::default();
    let options = ParseOptions {
        preserve_parens: false,
        ..ParseOptions::default()
    };
    let parsed = Parser::new(&allocator, source, source_type_of(filename))
        .with_options(options)
        .parse();
    if let Some(error) = parsed.diagnostics.errors().next() {
        let message = error.to_string();
        let first_line = message.lines().next().unwrap_or_default();
        return Ok(Err(first_line.to_owned()));
    }
    let mut finder = Finder {
        extension_event: Regex::new(EXTENSION_EVENT_NAME)?,
        found: None,
    };
    for statement in &parsed.program.body {
        finder.visit_statement(statement);
        if finder.found.is_some() {
            break;
        }
    }
    let found = finder.found.map(|(rule, start)| SideEffect {
        rule,
        line: line_of(source, usize::try_from(start).unwrap_or_default()),
    });
    Ok(Ok(found))
}

#[cfg(test)]
mod tests;
