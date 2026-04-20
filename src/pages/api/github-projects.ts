import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url }) => {
  const username = url.searchParams.get('username') || 'flyrenxing';

  try {
    // 获取用户的仓库，按 star 数排序
    const response = await fetch(
      `https://api.github.com/users/${username}/repos?sort=stars&per_page=30&type=owner`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch GitHub projects' }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const repos = await response.json();

    // 过滤并格式化项目数据
    const projects = repos
      .filter((repo: any) => !repo.fork || repo.stargazers_count > 0) // 过滤掉fork且无star的项目
      .map((repo: any) => ({
        name: repo.name,
        description: repo.description,
        url: repo.html_url,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language,
        topics: repo.topics?.slice(0, 5) || [],
        updatedAt: repo.updated_at,
        pushedAt: repo.pushed_at,
      }))
      .sort((a: any, b: any) => b.stars - a.stars); // 按 star 数降序排序

    return new Response(JSON.stringify(projects), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600', // 缓存 1 小时
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch GitHub projects' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};