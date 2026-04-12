/**
 * Forbids blank lines immediately after an opening tag or immediately before
 * a closing tag in Svelte templates. Applies to <script>, <style>, and every
 * HTML/component element:
 *
 *   <script lang="ts">      ← no blank line allowed right after
 *                           ← this is forbidden
 *     const x = 1;
 *                           ← this is forbidden
 *   </script>
 */

function checkElement(context, node) {
  const { sourceCode } = context;
  const { startTag, endTag } = node;
  if (!startTag || !endTag) {
    return;
  }

  const innerStart = startTag.range[1];
  const innerEnd = endTag.range[0];
  const inner = sourceCode.text.slice(innerStart, innerEnd);

  const leadingBlankPattern = /^(\r?\n)(\s*\r?\n)+/;
  const leadingMatch = leadingBlankPattern.exec(inner);
  if (leadingMatch) {
    const fullMatchLength = leadingMatch[0].length;
    const replacement = leadingMatch[1];
    context.report({
      node: startTag,
      messageId: "noBlankAfterOpeningTag",
      fix(fixer) {
        return fixer.replaceTextRange(
          [innerStart, innerStart + fullMatchLength],
          replacement
        );
      }
    });
  }

  const trailingBlankPattern = /(\r?\n)(\s*\r?\n)+(\s*)$/;
  const trailingMatch = trailingBlankPattern.exec(inner);
  if (trailingMatch) {
    const fullMatchLength = trailingMatch[0].length;
    const replacement = `${trailingMatch[1]}${trailingMatch[3]}`;
    context.report({
      node: endTag,
      messageId: "noBlankBeforeClosingTag",
      fix(fixer) {
        return fixer.replaceTextRange(
          [innerEnd - fullMatchLength, innerEnd],
          replacement
        );
      }
    });
  }
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "layout",
    fixable: "whitespace",
    schema: [],
    messages: {
      noBlankAfterOpeningTag: "Remove the blank line after the opening tag.",
      noBlankBeforeClosingTag: "Remove the blank line before the closing tag."
    }
  },
  create(context) {
    function handle(node) {
      checkElement(context, node);
    }

    return {
      SvelteScriptElement: handle,
      SvelteStyleElement: handle,
      SvelteElement: handle
    };
  }
};
