/**
 * background.js —— 图提取 ImageGrab 后台 Service Worker
 * 职责：
 *   1. 接收 content script 的 OPEN_GALLERY，保存图片列表并打开 gallery 页面
 *   2. 接收 gallery 的 DOWNLOAD_IMAGE，跨域拉取图片并转换为 PNG，返回字节给 gallery 完成下载
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_GALLERY') {
    handleOpenGallery(message.images).then(() => sendResponse({ ok: true }));
    return true; // 异步响应
  }

  if (message.type === 'DOWNLOAD_IMAGE') {
    handleDownload(message.url).then(sendResponse);
    return true; // 异步响应
  }

  return false;
});

// 点击工具栏图标时，直接打开 gallery（即使没有新提取的图片）
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') });
});

// 保存图片列表并打开预览页
async function handleOpenGallery(images) {
  const list = Array.isArray(images) ? images : [];
  await chrome.storage.local.set({ currentImages: list, extractedAt: Date.now() });
  await chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') });
}

// 下载处理：拉取图片并转为 PNG，返回字节数组
async function handleDownload(url) {
  try {
    const buffer = await fetchAndConvertToPng(url);
    return { ok: true, png: buffer };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}

// 跨域拉取 + OffscreenCanvas 转 PNG
async function fetchAndConvertToPng(url) {
  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) throw new Error('图片请求失败 HTTP ' + resp.status);

  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
  return await pngBlob.arrayBuffer();
}
