/** 导出工具：PNG（2×）/ SVG / HTML 快照 */

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 把 SVG 节点序列化成 2× 白底 PNG */
export function downloadPngFromSvg(svg: SVGSVGElement, filename: string, bg = '#F9FAFC') {
  const rect = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(rect.width || 1200));
  clone.setAttribute('height', String(rect.height || 800));
  const data = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([data], { type: 'image/svg+xml;charset=utf-8' }));
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((rect.width || 1200) * 2));
    c.height = Math.max(1, Math.round((rect.height || 800) * 2));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      triggerDownload(URL.createObjectURL(b), filename);
    });
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

/** 导出矢量 SVG 文件 */
export function downloadSvg(svg: SVGSVGElement, filename: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const data = new XMLSerializer().serializeToString(clone);
  triggerDownload(URL.createObjectURL(new Blob([data], { type: 'image/svg+xml;charset=utf-8' })), filename);
}

/** 把任意 DOM 区域（如矩阵表）栅格化成 2× PNG */
export function downloadPngFromElement(el: HTMLElement, filename: string, bg = '#F9FAFC') {
  const rect = el.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const styleText = Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n');
  const html = el.outerHTML;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<foreignObject width="100%" height="100%">
<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;background:${bg};font-family:'Microsoft YaHei UI','Microsoft YaHei',sans-serif">
<style>${styleText}</style>${html}
</div>
</foreignObject></svg>`;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = w * 2;
    c.height = h * 2;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      triggerDownload(URL.createObjectURL(b), filename);
    });
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    // 兜底：直接下载 HTML 快照
    triggerDownload(URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), filename.replace(/\.png$/, '.html'));
  };
  img.src = url;
}
