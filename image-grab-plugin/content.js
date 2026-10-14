/**
 * content.js —— 图提取 ImageGrab 内容脚本
 * 职责：
 *   1. 仅在电商商品详情页注入右下角「获取图片」悬浮按钮
 *   2. 点击后扫描页面所有商品图片（img / srcset / 懒加载 / 背景图）
 *   3. 过滤图标、logo、占位图、1x1 像素图、小于 100x100 的图片
 *   4. 相对路径补全为绝对 URL 并去重，通过 chrome.runtime.sendMessage 交给扩展
 */
(() => {
  'use strict';

  // 防止重复注入
  if (window.__imageGrabInjected) return;
  window.__imageGrabInjected = true;

  const BTN_ID = 'image-grab-btn';
  const TOAST_ID = 'image-grab-toast';

  // 常见图标/logo/占位图关键词，用于过滤
  const EXCLUDE_KEYWORDS = [
    'icon', 'logo', 'avatar', 'placeholder', 'blank', 'spacer', 'pixel',
    'loading', 'sprite', 'qrcode', 'qr_code', 'erweima', 'btn', 'button',
    'search', 'cart', 'share', 'close', 'arrow', 'throbber', 's.gif'
  ];

  /* ---------------- 工具函数 ---------------- */

  // 判断是否为商品详情页
  function isProductDetailPage() {
    const host = location.hostname;
    const path = location.pathname;
    if (host.includes('taobao.com') || host.includes('tmall.com')) {
      return /\/item\.htm/i.test(path) || host.includes('detail');
    }
    if (host.includes('jd.com')) {
      return host.startsWith('item.') || /\/product\/\d+/i.test(path);
    }
    if (host.includes('pinduoduo.com') || host.includes('yangkeduo.com')) {
      return /\/goods/i.test(path);
    }
    return false;
  }

  // 补全为绝对 URL
  function toAbsolute(url) {
    if (!url) return null;
    url = String(url).trim();
    if (!url) return null;
    if (url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('blob:')) return null;
    if (url.startsWith('//')) url = location.protocol + url;
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return null;
    }
  }

  // 按 URL 关键词过滤图标/logo/占位
  function isExcludedByUrl(url) {
    const lower = url.toLowerCase();
    return EXCLUDE_KEYWORDS.some((k) => lower.includes(k));
  }

  // 加载图片并读取真实尺寸（用于过滤小图）
  function loadImageSize(url) {
    return new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve(null), 5000);
      img.onload = () => {
        clearTimeout(timer);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = url;
    });
  }

  // 有限并发执行，避免一次请求过多
  async function runPool(items, worker, limit = 8) {
    const results = new Array(items.length);
    let index = 0;
    const tasks = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const i = index++;
        results[i] = await worker(items[i], i);
      }
    });
    await Promise.all(tasks);
    return results;
  }

  /* ---------------- 图片扫描 ---------------- */

  function collectCandidates() {
    const map = new Map(); // url -> { url, width, height }

    const add = (rawUrl, width = 0, height = 0) => {
      const abs = toAbsolute(rawUrl);
      if (!abs || isExcludedByUrl(abs)) return;
      const existing = map.get(abs);
      if (existing) {
        // 合并已知尺寸信息
        if (!existing.width && width) existing.width = width;
        if (!existing.height && height) existing.height = height;
        return;
      }
      map.set(abs, { url: abs, width, height });
    };

    // 1) <img> 标签及其懒加载属性
    document.querySelectorAll('img').forEach((img) => {
      const w = img.naturalWidth || parseInt(img.getAttribute('width')) || 0;
      const h = img.naturalHeight || parseInt(img.getAttribute('height')) || 0;
      const urls = [];
      if (img.currentSrc || img.src) urls.push(img.currentSrc || img.src);
      if (img.srcset) {
        img.srcset.split(',').forEach((part) => {
          const u = part.trim().split(/\s+/)[0];
          if (u) urls.push(u);
        });
      }
      const lazyAttrs = [
        'data-src', 'data-lazy-src', 'data-original', 'data-lazy',
        'data-url', 'data-echo', 'data-ks-lazyload', 'data-image'
      ];
      lazyAttrs.forEach((attr) => {
        const v = img.getAttribute(attr);
        if (v) urls.push(v);
      });
      urls.forEach((u) => add(u, w, h));
    });

    // 2) <source> 标签（picture 元素）
    document.querySelectorAll('source').forEach((src) => {
      if (src.srcset) {
        src.srcset.split(',').forEach((part) => {
          const u = part.trim().split(/\s+/)[0];
          if (u) add(u);
        });
      }
      const v = src.getAttribute('data-src') || src.getAttribute('src');
      if (v) add(v);
    });

    // 3) 背景图 background-image
    document.querySelectorAll('*').forEach((el) => {
      let bg = '';
      try {
        bg = window.getComputedStyle(el).backgroundImage;
      } catch (e) {
        bg = '';
      }
      if (!bg || bg === 'none') return;
      const matches = bg.match(/url\(["']?([^"')]+)["']?\)/g);
      if (!matches) return;
      matches.forEach((m) => {
        const url = m.replace(/url\(["']?|["']?\)/g, '').trim();
        add(url);
      });
    });

    return [...map.values()];
  }

  // 提取并过滤后的最终图片列表
  async function extractImages() {
    const candidates = collectCandidates();
    const filtered = [];

    await runPool(candidates, async (item) => {
      let { width, height } = item;
      // 尺寸未知时异步加载获取真实尺寸
      if (!(width > 0 && height > 0)) {
        const size = await loadImageSize(item.url);
        if (size) {
          width = size.width;
          height = size.height;
        }
      }
      // 过滤 1x1 像素图
      if (width === 1 && height === 1) return;
      // 过滤已知但小于 100x100 的图片
      if (width > 0 && height > 0 && (width < 100 || height < 100)) return;
      filtered.push({ url: item.url, width, height });
    });

    return filtered;
  }

  /* ---------------- UI：悬浮按钮 + Toast ---------------- */

  function createButton() {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '获取图片';
    btn.addEventListener('click', onButtonClick);
    document.body.appendChild(btn);
    return btn;
  }

  function showToast(text) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 2500);
  }

  async function onButtonClick() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '提取中...';
    try {
      const images = await extractImages();
      if (!images.length) {
        showToast('未找到符合条件的商品图片');
      } else {
        chrome.runtime.sendMessage({ type: 'OPEN_GALLERY', images }, () => {
          // 忽略 "Receiving end does not exist" 等错误
          void chrome.runtime.lastError;
        });
      }
    } catch (e) {
      showToast('提取失败：' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false;
      btn.textContent = '获取图片';
    }
  }

  /* ---------------- 启动 ---------------- */

  if (isProductDetailPage() && document.body) {
    createButton();
  }
})();
