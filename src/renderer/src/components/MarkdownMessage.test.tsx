import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownMessage } from './MarkdownMessage';

describe('MarkdownMessage', () => {
  it('renders GFM tables, task lists, inline code, and fenced code', () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage
        content={[
          '| Feature | State |',
          '| --- | --- |',
          '| Tables | `ready` |',
          '',
          '- [x] task done',
          '- [ ] task pending',
          '',
          '```ts',
          'const value: string = "ok"',
          '```'
        ].join('\n')}
      />
    );

    expect(html).toContain('<table>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<code>ready</code>');
    expect(html).toContain('message-code-shell');
    expect(html).toContain('ts');
  });

  it('escapes raw html instead of rendering it', () => {
    const html = renderToStaticMarkup(<MarkdownMessage content={'<img src=x onerror=alert(1)> **safe**'} />);

    // The XSS gate: no real `<img>` element exists in the DOM, and no
    // tag-style `onerror=` attribute attaches to a real element. The
    // escaped text content (`onerror=alert(1)` inside `&lt;img …&gt;`)
    // is harmless — the browser will display it as literal characters,
    // not parse it as markup. Checking for the literal string `onerror`
    // anywhere in the document was a too-strict assertion that flagged
    // the safe escaped form.
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/<[a-z][^>]*\bonerror\s*=/i);
    expect(html).toContain('&lt;img');
    expect(html).toContain('<strong>safe</strong>');
  });
});
