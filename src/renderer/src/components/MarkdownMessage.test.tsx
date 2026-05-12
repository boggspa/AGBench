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

    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).toContain('&lt;img');
    expect(html).toContain('<strong>safe</strong>');
  });
});
