import { useEffect, useRef, useState } from 'react';

// ============================================================
// Giscus 配置 — 请前往 https://giscus.app/zh-CN 生成你自己的值
// ============================================================
const GISCUS_CONFIG = {
  repo: 'FlyRenxing/content-repo',                    // 仓库：用户名/仓库名
  repoId: 'R_kgDOSHPfgg',                             // 仓库 ID
  category: 'Announcements',                          // Discussion 分类
  categoryId: 'DIC_kwDOSHPfgs4C7lZm',                 // 分类 ID
  mapping: 'pathname' as const,                       // 页面与 Discussion 的映射方式
  strict: '0' as const,
  reactionsEnabled: '1' as const,
  emitMetadata: '1' as const,
  inputPosition: 'top' as const,
  theme: 'preferred_color_scheme' as const,
  lang: 'zh-CN' as const,
  loading: 'lazy' as const,
};

export default function GiscusComments() {
  const ref = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    // 清理旧的 giscus iframe 和 script
    const existingIframe = ref.current.querySelector('iframe');
    if (existingIframe) {
      existingIframe.remove();
    }
    const existingScript = ref.current.querySelector('script');
    if (existingScript) {
      existingScript.remove();
    }

    setLoaded(false);

    const script = document.createElement('script');
    script.src = 'https://giscus.app/client.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute('data-repo', GISCUS_CONFIG.repo);
    script.setAttribute('data-repo-id', GISCUS_CONFIG.repoId);
    script.setAttribute('data-category', GISCUS_CONFIG.category);
    script.setAttribute('data-category-id', GISCUS_CONFIG.categoryId);
    script.setAttribute('data-mapping', GISCUS_CONFIG.mapping);
    script.setAttribute('data-strict', GISCUS_CONFIG.strict);
    script.setAttribute('data-reactions-enabled', GISCUS_CONFIG.reactionsEnabled);
    script.setAttribute('data-emit-metadata', GISCUS_CONFIG.emitMetadata);
    script.setAttribute('data-input-position', GISCUS_CONFIG.inputPosition);
    script.setAttribute('data-theme', GISCUS_CONFIG.theme);
    script.setAttribute('data-lang', GISCUS_CONFIG.lang);
    script.setAttribute('data-loading', GISCUS_CONFIG.loading);

    script.onload = () => setLoaded(true);

    ref.current.appendChild(script);

    // 监听 giscus 消息确认加载完成
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://giscus.app') return;
      if (event.data?.giscus?.discussion) {
        setLoaded(true);
      }
    };
    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  return (
    <div ref={ref} className="giscus-wrapper">
      {!loaded && (
        <div class="py-8 text-center text-sm text-slate-400 dark:text-zinc-500">
          加载评论中...
        </div>
      )}
    </div>
  );
}