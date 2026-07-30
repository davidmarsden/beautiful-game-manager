(() => {
  Response.prototype.json = async function safeJson() {
    const contentType = this.headers.get('content-type') || 'unknown content type';
    const status = `HTTP ${this.status || 0}`;
    let text;

    try {
      text = await this.text();
    } catch (error) {
      throw new Error(`${status}; could not read response body (${contentType})`, { cause: error });
    }

    const compact = text.trim().replace(/\s+/g, ' ');
    const excerpt = compact.slice(0, 500);

    if (!compact) {
      throw new Error(`${status}; empty response body (${contentType})`);
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`${status}; invalid JSON response (${contentType})${excerpt ? ` · ${excerpt}` : ''}`, {
        cause: error
      });
    }
  };
})();
