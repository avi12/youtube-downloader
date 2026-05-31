/**
 * Enforces that when a function call receives a multiline non-literal argument
 * (e.g. a callback or a chained call expression), the opening parenthesis must
 * be followed by a newline and the closing parenthesis must be on its own line:
 *
 *   foo(
 *     items.map(item => {
 *       return item;
 *     })
 *   );
 *
 * Direct callbacks, object literals, and array literals are excluded — they
 * conventionally stay inline with the call:
 *
 *   foo({ key: value });        // OK — ObjectExpression
 *   untrack(() => { ... });     // OK — ArrowFunctionExpression
 *   new Promise(resolve => {})  // OK — ArrowFunctionExpression
 */

const inlineArgumentTypes = new Set([
  "ObjectExpression",
  "ArrayExpression",
  "ArrowFunctionExpression",
  "FunctionExpression"
]);

function getEffectiveType(arg) {
  if (arg.type === "TSSatisfiesExpression" || arg.type === "TSAsExpression") {
    return arg.expression.type;
  }

  return arg.type;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "layout",
    fixable: "code",
    schema: [],
    messages: {
      argumentOnNewLine: "When a multiline argument is passed, it must start on a new line after '('.",
      closingParenOnNewLine: "When a multiline argument is passed, ')' must be on its own line.",
      inlineArgumentOnNewLine: "Object/array/function arguments must stay inline with the opening '('."
    }
  },
  create(context) {
    const { sourceCode } = context;

    return {
      CallExpression(node) {
        if (node.arguments.length === 0) {
          return;
        }

        const hasMultilineNonLiteralArgument = node.arguments.some(
          arg => !inlineArgumentTypes.has(getEffectiveType(arg)) && arg.loc.start.line !== arg.loc.end.line
        );

        const firstArg = node.arguments[0];
        const openParen = sourceCode.getTokenBefore(firstArg);
        const lastArg = node.arguments[node.arguments.length - 1];
        const closeParen = sourceCode.getLastToken(node);        if (!hasMultilineNonLiteralArgument) {
          const allInlineTypes = node.arguments.every(arg => inlineArgumentTypes.has(getEffectiveType(arg)));
          const hasAnyMultilineArgument = node.arguments.some(arg => arg.loc.start.line !== arg.loc.end.line);
          const isFirstArgOnNewLine = openParen.loc.end.line !== firstArg.loc.start.line;
          const isSingleArgument = node.arguments.length === 1;
          if (allInlineTypes && !hasAnyMultilineArgument && isFirstArgOnNewLine && isSingleArgument) {
            const MAX_LINE_LENGTH = 120;
            const prefixLength = openParen.loc.end.column;
            const argsEndLength = lastArg.loc.end.column + (closeParen.loc.start.line === lastArg.loc.end.line ? 1 : 0);
            const resultingLineLength = prefixLength + (firstArg.loc.start.line === lastArg.loc.end.line
              ? lastArg.loc.end.column - firstArg.loc.start.column + 1
              : argsEndLength);
            if (resultingLineLength <= MAX_LINE_LENGTH) {
              context.report({
                node,
                messageId: "inlineArgumentOnNewLine",
                fix(fixer) {
                  return fixer.replaceTextRange(
                    [openParen.range[1], firstArg.range[0]],
                    ""
                  );
                }
              });
            }
          }

          return;
        }

        const baseIndent = " ".repeat(node.loc.start.column);
        const argIndent = `${baseIndent}  `;
        if (openParen.loc.end.line === firstArg.loc.start.line) {
          context.report({
            node,
            messageId: "argumentOnNewLine",
            fix: fixer => fixer.insertTextAfter(openParen, `\n${argIndent}`)
          });
        }

        if (closeParen.loc.start.line === lastArg.loc.end.line) {
          context.report({
            node,
            messageId: "closingParenOnNewLine",
            fix: fixer => fixer.insertTextBefore(closeParen, `\n${baseIndent}`)
          });
        }
      }
    };
  }
};
