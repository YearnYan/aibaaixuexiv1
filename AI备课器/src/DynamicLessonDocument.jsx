import React from 'react';
import { RichText } from './RichText.jsx';
import { sanitizeBlackboard } from './lessonText.js';

function RichValue({ children }) {
  return <RichText>{children || ''}</RichText>;
}

function DynamicParagraph({ block, blackboard }) {
  const text = blackboard ? sanitizeBlackboard(block.text) : block.text;
  return <p className={`dynamic-paragraph variant-${block.variant} align-${block.align}`}><RichValue>{text}</RichValue></p>;
}

function DynamicList({ block }) {
  const Tag = block.style === 'ordered' ? 'ol' : 'ul';
  return <Tag className={`dynamic-list style-${block.style}`} style={{ '--dynamic-columns': block.columns }}>
    {block.items.map((item, index) => <li key={`${index}-${item.slice(0, 24)}`}><RichValue>{item}</RichValue></li>)}
  </Tag>;
}

function DynamicKeyValue({ block }) {
  return <div className="dynamic-key-value" style={{ '--dynamic-columns': block.columns }}>
    {block.items.map((item, index) => <section key={`${index}-${item.label}`}><strong><RichValue>{item.label}</RichValue></strong><p><RichValue>{item.value}</RichValue></p></section>)}
  </div>;
}

function DynamicCards({ block, timeline = false }) {
  return <div className={timeline ? 'dynamic-timeline' : 'dynamic-cards'} style={{ '--dynamic-columns': block.columns }}>
    {block.items.map((item, index) => <section className={timeline ? 'dynamic-timeline-item' : 'dynamic-card'} key={`${index}-${item.title}`}>
      <header>
        {timeline ? <span>{String(index + 1).padStart(2, '0')}</span> : null}
        <div>
          {item.title ? <h3><RichValue>{item.title}</RichValue></h3> : null}
          {item.subtitle ? <p className="dynamic-card-subtitle"><RichValue>{item.subtitle}</RichValue></p> : null}
        </div>
        {item.meta ? <em><RichValue>{item.meta}</RichValue></em> : null}
      </header>
      {item.body ? <p className="dynamic-card-body"><RichValue>{item.body}</RichValue></p> : null}
      {item.fields.length ? <div className="dynamic-card-fields">{item.fields.map((field, fieldIndex) => <p key={`${fieldIndex}-${field.label}`}><strong><RichValue>{field.label}</RichValue></strong><RichValue>{field.value}</RichValue></p>)}</div> : null}
    </section>)}
  </div>;
}

function DynamicTable({ block }) {
  const columnCount = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1);
  return <div className="dynamic-table-wrap"><table className="dynamic-table">
    {block.headers.length ? <thead><tr>{Array.from({ length: columnCount }, (_, index) => <th key={index}><RichValue>{block.headers[index]}</RichValue></th>)}</tr></thead> : null}
    <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{Array.from({ length: columnCount }, (_, columnIndex) => <td key={columnIndex}><RichValue>{row[columnIndex]}</RichValue></td>)}</tr>)}</tbody>
  </table></div>;
}

function DynamicImage({ block }) {
  if (!block.src) return <p className="dynamic-image-fallback">图片地址无效，已保留图片说明：<RichValue>{block.alt || block.caption}</RichValue></p>;
  return <figure className="dynamic-image"><img src={block.src} alt={block.alt || block.caption || '教学图片'} referrerPolicy="no-referrer" />{block.caption ? <figcaption><RichValue>{block.caption}</RichValue></figcaption> : null}</figure>;
}

function DynamicSvg({ block, blackboard }) {
  const content = blackboard ? sanitizeBlackboard(block.content) : block.content;
  return <figure className="dynamic-svg"><RichValue>{content}</RichValue>{block.caption ? <figcaption><RichValue>{block.caption}</RichValue></figcaption> : null}</figure>;
}

function DynamicBlock({ block, blackboard }) {
  if (block.type === 'paragraph') return <DynamicParagraph block={block} blackboard={blackboard} />;
  if (block.type === 'list') return <DynamicList block={block} />;
  if (block.type === 'keyValue') return <DynamicKeyValue block={block} />;
  if (block.type === 'cards') return <DynamicCards block={block} />;
  if (block.type === 'timeline') return <DynamicCards block={block} timeline />;
  if (block.type === 'table') return <DynamicTable block={block} />;
  if (block.type === 'image') return <DynamicImage block={block} />;
  if (block.type === 'svg') return <DynamicSvg block={block} blackboard={blackboard} />;
  if (block.type === 'divider') return <hr className="dynamic-divider" />;
  return null;
}

export function DynamicLessonDocument({ plan, documentRef }) {
  const appearance = plan.appearance || {};
  const cover = plan.cover || {};
  const footer = plan.footer || {};
  return <article className={`lesson-document dynamic-lesson-document theme-${appearance.theme || 'classic'} density-${appearance.density || 'comfortable'}`} ref={documentRef}>
    <div className="document-cover dynamic-document-cover">
      {cover.kicker ? <p className="document-kicker"><RichValue>{cover.kicker}</RichValue></p> : null}
      <h1><RichValue>{cover.title || plan.title}</RichValue></h1>
      {cover.subtitle ? <p className="document-subtitle"><RichValue>{cover.subtitle}</RichValue></p> : null}
      {cover.meta?.length ? <dl className="document-meta dynamic-document-meta">{cover.meta.map((item, index) => <div key={`${index}-${item.label}`}><dt><RichValue>{item.label}</RichValue></dt><dd><RichValue>{item.value}</RichValue></dd></div>)}</dl> : null}
    </div>
    <div className={`dynamic-sections page-layout-${appearance.pageLayout || 'single'}`}>
      {plan.sections.map((section, index) => <section className={`document-section dynamic-section section-layout-${section.layout}`} key={section.id}>
        <div className="document-section-title"><span>{String(index + 1).padStart(2, '0')}</span><h2><RichValue>{section.title}</RichValue></h2></div>
        <div className="dynamic-blocks">{section.blocks.map((block, blockIndex) => <DynamicBlock block={block} blackboard={section.layout === 'blackboard'} key={`${section.id}-${blockIndex}`} />)}</div>
      </section>)}
    </div>
    <footer className="document-footer"><span><RichValue>{footer.brand}</RichValue></span>{footer.note ? <p><RichValue>{footer.note}</RichValue></p> : null}</footer>
  </article>;
}
