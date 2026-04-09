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

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "layout",
    fixable: "code",
    schema: [],
    messages: {
      argumentOnNewLine: "When a multiline argument is passed, it must start on a new line after '('.",
      closingParenOnNewLine: "When a multiline argument is passed, ')' must be on its own line."
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
          arg => !inlineArgumentTypes.has(arg.type) && arg.loc.start.line !== arg.loc.end.line
        );

        if (!hasMultilineNonLiteralArgument) {
          return;
        }

        const firstArg = node.arguments[0];
        const openParen = sourceCode.getTokenBefore(firstArg);
        const lastArg = node.arguments[node.arguments.length - 1];
        const closeParen = sourceCode.getLastToken(node);
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
