(() => {
  const nativeJson = Response.prototype.json;

  Response.prototype.json = async function safeJson() {
    const diagnosticCopy = this.clone();
    try {
      return await nativeJson.call(this);
    } catch (error) {
      const text = await diagnosticCopy.text().catch(() => '');
      const compact = text.trim().replace(/\s+/g, ' ');
      const excerpt = compact.slice(0, 500);
      const contentType = diagnosticCopy.headers.get('content-type') || 'unknown content type';
      const status = `HTTP ${diagnosticCopy.status || 0}`;

      if (!compact) {
        throw new Error(`${status}; empty response body (${contentType})`);
      }

      throw new Error(`${status}; invalid JSON response (${contentType})${excerpt ? ` · ${excerpt}` : ''}`, {
        cause: error
      });
    }
  };
})();
