/**
 * Enforces that Promise.all() arguments start on a new line:
 *
 *   await Promise.all(
 *     items.map(async item => { ... })
 *   );
 *
 * rather than:
 *
 *   await Promise.all(items.map(async item => { ... }));
 */

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "layout",
    fixable: "code",
    schema: [],
    messages: {
      argumentOnNewLine: "Promise.all() argument must start on a new line after the opening parenthesis.",
      closingParenOnNewLine: "Promise.all() closing parenthesis must be on its own line."
    }
  },
  create(context) {
    const { sourceCode } = context;

    return {
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.object.type !== "Identifier" ||
          node.callee.object.name !== "Promise" ||
          node.callee.property.type !== "Identifier" ||
          node.callee.property.name !== "all" ||
          node.arguments.length === 0
        ) {
          return;
        }

        const openParen = sourceCode.getTokenAfter(node.callee);
        const firstArg = node.arguments[0];
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
