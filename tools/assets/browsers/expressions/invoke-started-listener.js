function (handler, type, contentScriptName, messageId) {
  handler.call(this, new CustomEvent(type, { detail: { contentScriptName, messageId } }));
}
