/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "layout",
    fixable: "whitespace",
    schema: [],
    messages: {
      expand: "Svelte block content must start on a new line."
    }
  },
  create(context) {
    const { sourceCode } = context;

    function findOpenTagEnd(expression) {
      const source = sourceCode.text;
      let pos = expression.range[1];
      while (pos < source.length && source[pos] !== "}") {
        pos++;
      }
      return pos + 1;
    }

    function getIndent(node) {
      return sourceCode.lines[node.loc.start.line - 1].match(/^(\s*)/)[1];
    }

    return {
      SvelteIfBlock(node) {
        if (!node.children.length) {
          return;
        }

        const firstChild = node.children[0];
        if (node.loc.start.line !== firstChild.loc.start.line) {
          return;
        }

        context.report({
          node,
          messageId: "expand",
          fix(fixer) {
            const indent = getIndent(node);
            const childIndent = `${indent}  `;
            const openTagEnd = findOpenTagEnd(node.expression);
            const fixes = [
              fixer.replaceTextRange([openTagEnd, firstChild.range[0]], `\n${childIndent}`)
            ];

            if (!node.else && !node.elseif) {
              const lastChild = node.children[node.children.length - 1];
              if (node.loc.end.line === lastChild.loc.end.line) {
                const closeTagStart = node.range[1] - 5;
                fixes.push(fixer.replaceTextRange([lastChild.range[1], closeTagStart], `\n${indent}`));
              }
            }

            return fixes;
          }
        });
      }
    };
  }
};
