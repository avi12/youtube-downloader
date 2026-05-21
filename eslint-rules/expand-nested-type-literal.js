/**
 * Requires multi-line formatting for TypeScript type literals ({ ... }) when:
 * - The literal has 2 or more members, OR
 * - Any member's type annotation is itself a type literal (direct nesting), OR
 * - Any member's key name exceeds LONG_KEY_NAME_LENGTH characters
 *
 * Single-member leaf types with short keys may stay on one line:
 *   title: { simpleText: string }                    // OK — short key, leaf
 *   liveBroadcastDetails?: { isLiveNow: true; ... }  // expanded — 2 members
 *
 * Expanded due to long key:
 *   mediaUstreamerRequestConfig?: {
 *     videoPlaybackUstreamerConfig?: string;          // key > 20 chars
 *   };
 */

const LONG_KEY_NAME_LENGTH = 20;

function memberHasDirectTypeLiteral(member) {
  return member.typeAnnotation?.typeAnnotation?.type === "TSTypeLiteral";
}

function memberHasLongKey(member) {
  return member.type === "TSPropertySignature"
    && (member.key?.name?.length ?? 0) > LONG_KEY_NAME_LENGTH;
}

function requiresMultiline(node) {
  return node.members.length >= 2
    || node.members.some(memberHasDirectTypeLiteral)
    || node.members.some(memberHasLongKey);
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
      expectedNewlineAfterOpenBrace: "Expected a newline after '{' in this type literal.",
      expectedNewlineBeforeCloseBrace: "Expected a newline before '}' in this type literal.",
      expectedNewlineBetweenMembers: "Expected each member to be on its own line."
    }
  },
  create(context) {
    const { sourceCode } = context;

    return {
      TSTypeLiteral(node) {
        if (node.members.length === 0 || !requiresMultiline(node)) {
          return;
        }

        const openBrace = sourceCode.getFirstToken(node);
        const closeBrace = sourceCode.getLastToken(node);
        const lineIndentCount = getLineIndentCount(sourceCode, openBrace);
        const baseIndent = " ".repeat(lineIndentCount);
        const memberIndent = `${baseIndent}  `;

        const firstMember = node.members[0];
        if (openBrace.loc.end.line === firstMember.loc.start.line) {
          context.report({
            node,
            messageId: "expectedNewlineAfterOpenBrace",
            fix: fixer => fixer.insertTextAfter(openBrace, `\n${memberIndent}`)
          });
        }

        for (let memberIndex = 1; memberIndex < node.members.length; memberIndex++) {
          const previousMember = node.members[memberIndex - 1];
          const currentMember = node.members[memberIndex];
          if (previousMember.loc.end.line === currentMember.loc.start.line) {
            const tokenBeforeCurrent = sourceCode.getTokenBefore(currentMember);
            context.report({
              node: currentMember,
              messageId: "expectedNewlineBetweenMembers",
              fix: fixer => fixer.insertTextAfter(tokenBeforeCurrent, `\n${memberIndent}`)
            });
          }
        }

        const lastMember = node.members[node.members.length - 1];
        if (closeBrace.loc.start.line === lastMember.loc.end.line) {
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
