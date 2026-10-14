/**
 * main.js —— 图提取 ImageGrab 官网交互脚本
 * 功能：移动端菜单、导航吸顶、锚点平滑滚动、导航高亮、滚动显现动画
 */
document.addEventListener('DOMContentLoaded', () => {
  const navbar = document.getElementById('navbar');
  const burger = document.getElementById('burger');
  const menu = document.getElementById('menu');

  /* 移动端汉堡菜单开关 */
  burger.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    burger.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
  });

  // 点击菜单项后收起移动端菜单
  menu.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => {
      menu.classList.remove('open');
      burger.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    });
  });

  /* 锚点平滑滚动 */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id.length > 1) {
        const target = document.querySelector(id);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });

  /* 导航吸顶 + 高亮 */
  const sections = [...document.querySelectorAll('section[id]')];

  function onScroll() {
    navbar.classList.toggle('scrolled', window.scrollY > 10);

    let current = '';
    const pos = window.scrollY + 140;
    sections.forEach((sec) => {
      if (sec.offsetTop <= pos) current = sec.id;
    });
    menu.querySelectorAll('a').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current);
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* 滚动显现动画 */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
});
