/**
 * Requires multi-line formatting for object literals inside spread expressions
 * such as `{ ...cond && { key: value } }`.
 *
 * An object literal must be expanded when:
 *   1. Any property is in `key: value` form (i.e., not shorthand), OR
 *   2. The object is on a single source line whose length exceeds MAX_LINE_LENGTH.
 *
 * Shorthand-only objects that fit on the current line stay inline.
 *
 *   { ...cond && { headers: { Range: `bytes=${o}-` } } }   → both expanded (case 1)
 *   { ...cond && { headers: { Range } } }                  → outer expanded only
 *   { ...cond && { foo: { bar1, bar2 } } }                 → outer expanded only
 *   { ...cond && { foo: { aLongName1, aLongName2, ... } }} → both expanded if > 120 chars
 *
 * Empty objects stay compact.
 */

const MAX_LINE_LENGTH = 120;

function getLineIndentCount(sourceCode, token) {
  const lineText = sourceCode.lines[token.loc.start.line - 1];
  const match = lineText.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

function collectObjectExpressions(node, accumulator) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (node.type === "ObjectExpression") {
    accumulator.push(node);
  }

  if (node.type === "LogicalExpression") {
    collectObjectExpressions(node.left, accumulator);
    collectObjectExpressions(node.right, accumulator);
    return;
  }

  if (node.type === "ConditionalExpression") {
    collectObjectExpressions(node.consequent, accumulator);
    collectObjectExpressions(node.alternate, accumulator);
    return;
  }

  if (node.type === "Property") {
    collectObjectExpressions(node.value, accumulator);
  }
}

function objectRequiresMultiline(node, sourceCode) {
  if (node.properties.length === 0) {
    return false;
  }

  for (const property of node.properties) {
    if (property.type === "Property" && !property.shorthand) {
      return true;
    }
  }

  if (node.loc.start.line !== node.loc.end.line) {
    return false;
  }

  const sourceLine = sourceCode.lines[node.loc.start.line - 1];
  return sourceLine.length > MAX_LINE_LENGTH;
}

function expandObjectExpression(node, sourceCode) {
  const reports = [];
  if (!objectRequiresMultiline(node, sourceCode)) {
    return reports;
  }

  const openBrace = sourceCode.getFirstToken(node);
  const closeBrace = sourceCode.getLastToken(node);
  const lineIndentCount = getLineIndentCount(sourceCode, openBrace);
  const baseIndent = " ".repeat(lineIndentCount);
  const propertyIndent = `${baseIndent}  `;

  const firstProperty = node.properties[0];
  if (openBrace.loc.end.line === firstProperty.loc.start.line) {
    reports.push({
      node,
      messageId: "newlineAfterOpenBrace",
      fix: fixer => fixer.insertTextAfter(openBrace, `\n${propertyIndent}`)
    });
  }

  for (let i = 1; i < node.properties.length; i++) {
    const previous = node.properties[i - 1];
    const current = node.properties[i];
    if (previous.loc.end.line === current.loc.start.line) {
      const tokenBefore = sourceCode.getTokenBefore(current);
      reports.push({
        node: current,
        messageId: "newlineBetweenProperties",
        fix: fixer => fixer.insertTextAfter(tokenBefore, `\n${propertyIndent}`)
      });
    }
  }

  const lastProperty = node.properties[node.properties.length - 1];
  if (closeBrace.loc.start.line === lastProperty.loc.end.line) {
    reports.push({
      node,
      messageId: "newlineBeforeCloseBrace",
      fix: fixer => fixer.insertTextBefore(closeBrace, `\n${baseIndent}`)
    });
  }

  for (const property of node.properties) {
    if (property.type === "Property" && property.value.type === "ObjectExpression") {
      reports.push(...expandObjectExpression(property.value, sourceCode));
    }
  }

  return reports;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "layout",
    fixable: "whitespace",
    schema: [],
    messages: {
      newlineAfterOpenBrace: "Object literal in spread must start on a new line after '{'.",
      newlineBetweenProperties: "Each property of an expanded spread object literal must be on its own line.",
      newlineBeforeCloseBrace: "'}' of an expanded spread object literal must be on its own line."
    }
  },
  create(context) {
    const { sourceCode } = context;

    return {
      SpreadElement(node) {
        const objectExpressions = [];
        collectObjectExpressions(node.argument, objectExpressions);

        for (const objectExpression of objectExpressions) {
          for (const report of expandObjectExpression(objectExpression, sourceCode)) {
            context.report(report);
          }
        }
      }
    };
  }
};
