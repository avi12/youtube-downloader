/**
 * Requires multi-line formatting for object expressions ({ ... }) when:
 * - The object has 2 or more properties, OR
 * - Any property's value is itself an object expression (direct nesting), OR
 * - The object sits inside an `&&` / `||` logical expression (typically a
 *   conditional spread like `...cond && { ... }`); these read better fully
 *   expanded so the spread block is visually self-contained.
 *
 * Single-property leaf objects with primitive/identifier values may stay on one line:
 *   { signatureTimestamp }                              // OK — leaf
 *   { x: 1 }                                            // OK — leaf
 *
 * Expanded due to nested object:
 *   {
 *     contentPlaybackContext: { signatureTimestamp }    // parent expands; deepest stays inline
 *   }
 *
 * Expanded due to `&&` ancestor (every nested object also expands):
 *   ...byteOffset > 0 && {
 *     headers: {
 *       Range: ...
 *     }
 *   }
 */

function propertyHasDirectObjectExpression(property) {
  return property.type === "Property" && property.value?.type === "ObjectExpression";
}

function isInsideLogicalExpression(node) {
  let current = node.parent;
  while (current) {
    if (current.type === "LogicalExpression" && (current.operator === "&&" || current.operator === "||")) {
      return true;
    }

    if (current.type === "FunctionDeclaration"
      || current.type === "FunctionExpression"
      || current.type === "ArrowFunctionExpression"
      || current.type === "Program") {
      return false;
    }

    current = current.parent;
  }

  return false;
}

function requiresMultiline(node) {
  return node.properties.length >= 2
    || node.properties.some(propertyHasDirectObjectExpression)
    || isInsideLogicalExpression(node);
}

function getLineIndentCount(sourceCode, token) {
  const lineText = sourceCode.lines[token.loc.start.line - 1];
  const match = lineText.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "layout",
    fixable: "code",
    schema: [],
    messages: {
      expectedNewlineAfterOpenBrace: "Expected a newline after '{' in this object literal.",
      expectedNewlineBeforeCloseBrace: "Expected a newline before '}' in this object literal.",
      expectedNewlineBetweenProperties: "Expected each property to be on its own line."
    }
  },
  create(context) {
    const { sourceCode } = context;

    return {
      ObjectExpression(node) {
        if (node.properties.length === 0 || !requiresMultiline(node)) {
          return;
        }

        const openBrace = sourceCode.getFirstToken(node);
        const closeBrace = sourceCode.getLastToken(node);
        const lineIndentCount = getLineIndentCount(sourceCode, openBrace);
        const baseIndent = " ".repeat(lineIndentCount);
        const propertyIndent = `${baseIndent}  `;

        const firstProperty = node.properties[0];
        if (openBrace.loc.end.line === firstProperty.loc.start.line) {
          context.report({
            node,
            messageId: "expectedNewlineAfterOpenBrace",
            fix: fixer => fixer.insertTextAfter(openBrace, `\n${propertyIndent}`)
          });
        }

        for (let propertyIndex = 1; propertyIndex < node.properties.length; propertyIndex++) {
          const previousProperty = node.properties[propertyIndex - 1];
          const currentProperty = node.properties[propertyIndex];
          if (previousProperty.loc.end.line === currentProperty.loc.start.line) {
            const tokenBeforeCurrent = sourceCode.getTokenBefore(currentProperty);
            context.report({
              node: currentProperty,
              messageId: "expectedNewlineBetweenProperties",
              fix: fixer => fixer.insertTextAfter(tokenBeforeCurrent, `\n${propertyIndent}`)
            });
          }
        }

        const lastProperty = node.properties[node.properties.length - 1];
        if (closeBrace.loc.start.line === lastProperty.loc.end.line) {
          context.report({
            node,
            messageId: "expectedNewlineBeforeCloseBrace",
            fix: fixer => fixer.insertTextBefore(closeBrace, `\n${baseIndent}`)
          });
        }
      }
    };
  }
};
