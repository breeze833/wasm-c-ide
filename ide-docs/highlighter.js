// ide-docs/highlighter.js - Zero-dependency C and Shell syntax highlighter for documentation

(function() {
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlightC(code) {
    if (code.includes('token-')) return code;

    const tokens = [];
    function saveToken(html) {
      tokens.push(html);
      return `__TOKEN_${tokens.length - 1}__`;
    }

    // 1. Comments: // ... and /* ... */
    let text = code.replace(/\/\/[^\n]*/g, m => saveToken(`<span class="token-comment">${m}</span>`));
    text = text.replace(/\/\*[\s\S]*?\*\//g, m => saveToken(`<span class="token-comment">${m}</span>`));

    // 2. Preprocessor: #include <...>, #define, etc.
    text = text.replace(/#\s*(include|define|ifdef|ifndef|endif|else|pragma)\b[^\n]*/g, m => {
      const parts = m.match(/^(#\s*\w+)(\s+)(&lt;[^&]+&gt;|<[^>]+>|"[^"]+")(.*)$/);
      if (parts) {
        return saveToken(`<span class="token-prep">${parts[1]}</span>${parts[2]}<span class="token-str">${parts[3]}</span>${parts[4]}`);
      }
      return saveToken(`<span class="token-prep">${m}</span>`);
    });

    // 3. String literals: "..." and '...'
    text = text.replace(/"(\\.|[^"\\])*"/g, m => saveToken(`<span class="token-str">${m}</span>`));
    text = text.replace(/'(\\.|[^'\\])*'/g, m => saveToken(`<span class="token-str">${m}</span>`));

    // 4. Shell prompts: lines starting with $ or sqlite>
    text = text.replace(/^(\$\s+)(.*)$/gm, (_, p1, p2) => {
      return saveToken(`<span class="token-prompt">$</span> `) + p2;
    });
    text = text.replace(/^(sqlite&gt;\s+|sqlite>\s+)(.*)$/gm, (_, p1, p2) => {
      return saveToken(`<span class="token-prompt">sqlite&gt;</span> `) + p2;
    });

    // 5. Numbers: hex (0x...), floats, integers
    text = text.replace(/\b(0x[0-9a-fA-F]+|\d+(\.\d+)?f?)\b/g, m => {
      return saveToken(`<span class="token-num">${m}</span>`);
    });

    // 6. Types
    const typeRegex = /\b(uint32_t|uint16_t|uint8_t|int32_t|int16_t|int8_t|size_t|FILE|sqlite3|sqlite3_stmt|turtle_canvas_wasi_context_t|turtle_raylib_context_t|Vector2|Vector3|Color|Sound|Music)\b/g;
    text = text.replace(typeRegex, m => saveToken(`<span class="token-type">${m}</span>`));

    // 7. Keywords
    const kwRegex = /\b(int|char|void|float|double|bool|struct|union|enum|typedef|const|static|extern|sizeof|return|if|else|while|for|do|switch|case|break|continue|default|goto|NULL|true|false)\b/g;
    text = text.replace(kwRegex, m => saveToken(`<span class="token-kw">${m}</span>`));

    // 8. Functions: identifier followed by (
    text = text.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)(?=\s*\()/g, m => {
      if (/^(if|while|for|switch|sizeof|return)$/.test(m)) return m;
      return saveToken(`<span class="token-fn">${m}</span>`);
    });

    // Restore saved tokens
    return text.replace(/__TOKEN_(\d+)__/g, (_, idx) => tokens[parseInt(idx, 10)]);
  }

  function highlightAll() {
    const codeBlocks = document.querySelectorAll('pre:not(.diagram):not(.no-highlight) code');
    codeBlocks.forEach(block => {
      if (block.querySelector('.token-kw, .token-prep, .token-fn, .token-str')) return;
      const raw = block.innerHTML;
      block.innerHTML = highlightC(raw);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', highlightAll);
  } else {
    highlightAll();
  }
})();
