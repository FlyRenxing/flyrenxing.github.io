/**
 * Pre-build Script: AI 增强层
 *
 * 功能：
 * 1. 读取 content/posts/ 目录的 MDX 文件
 * 2. 调用智谱 API 生成摘要
 * 3. 调用智谱 API 生成 Hero 图片提示词
 * 4. 调用 SiliconFlow API 生成 Hero 图片
 * 5. 使用 Orama 构建搜索索引
 *
 * 使用方法：
 *   node scripts/pre-build.js
 *
 * 环境变量：
 *   ZHIPU_API_KEY    - 智谱 API 密钥（用于摘要和提示词生成）
 *   SILICONFLOW_KEY  - SiliconFlow API 密钥（用于图片生成）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { create, insert, save } from '@orama/orama';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// 配置
const CONTENT_DIR = path.join(ROOT_DIR, 'content', 'posts');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const HERO_DIR = path.join(PUBLIC_DIR, 'images', 'hero');
const SEARCH_INDEX_PATH = path.join(PUBLIC_DIR, 'search-index.json');

// Content Repo 路径（本地开发时）
const CONTENT_REPO_PATH = path.resolve(ROOT_DIR, '..', 'content-repo', 'content');

/**
 * 从 content-repo 同步内容（本地开发）
 */
function syncFromContentRepo() {
  const postsSrc = path.join(CONTENT_REPO_PATH, 'posts');
  const imagesSrc = path.join(CONTENT_REPO_PATH, 'images');

  // 同步文章
  if (fs.existsSync(postsSrc)) {
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
    const files = fs.readdirSync(postsSrc).filter(f => f.endsWith('.mdx'));
    for (const file of files) {
      const src = path.join(postsSrc, file);
      const dest = path.join(CONTENT_DIR, file);
      if (!fs.existsSync(dest) || fs.statSync(src).mtime > fs.statSync(dest).mtime) {
        fs.copyFileSync(src, dest);
        console.log(`📄 同步文章: ${file}`);
      }
    }
  }

  // 同步图片
  if (fs.existsSync(imagesSrc)) {
    const imagesDest = path.join(PUBLIC_DIR, 'images');
    fs.mkdirSync(imagesDest, { recursive: true });
    const files = fs.readdirSync(imagesSrc);
    for (const file of files) {
      const src = path.join(imagesSrc, file);
      const dest = path.join(imagesDest, file);
      if (!fs.existsSync(dest) || fs.statSync(src).mtime > fs.statSync(dest).mtime) {
        fs.copyFileSync(src, dest);
        console.log(`🖼️  同步图片: ${file}`);
      }
    }
  }
}

// 增强的分词器 - 支持中英文，支持前缀匹配
function tokenize(text) {
  if (!text) return [];
  const tokens = new Set();
  const lowerText = text.toLowerCase();
  const chineseRegex = /[\u4e00-\u9fff]/;

  // 分割文本为中英文片段
  let current = '';
  let isChinese = false;

  for (const char of lowerText) {
    const charIsChinese = chineseRegex.test(char);
    if (charIsChinese === isChinese && char !== ' ' && char !== '\n' && !/[\p{P}]/u.test(char)) {
      current += char;
    } else {
      if (current) {
        processSegment(current, isChinese, tokens);
      }
      current = charIsChinese ? char : '';
      isChinese = charIsChinese;
    }
  }
  if (current) {
    processSegment(current, isChinese, tokens);
  }

  return Array.from(tokens);
}

function processSegment(segment, isChinese, tokens) {
  if (isChinese) {
    // 中文：生成单字、双字、三字 n-gram
    const chars = Array.from(segment);
    // 单字
    for (const char of chars) tokens.add(char);
    // 双字组合
    for (let i = 0; i < chars.length - 1; i++) tokens.add(chars[i] + chars[i + 1]);
    // 三字组合
    for (let i = 0; i < chars.length - 2; i++) tokens.add(chars[i] + chars[i + 1] + chars[i + 2]);
    // 完整词
    if (segment.length > 1) tokens.add(segment);
  } else {
    // 英文：生成前缀 n-gram 支持前缀匹配
    const word = segment.toLowerCase();
    tokens.add(word); // 完整词
    // 生成前缀（至少2个字符）
    for (let i = 2; i < word.length; i++) {
      tokens.add(word.slice(0, i));
    }
  }
}

// Orama 搜索索引配置
const searchSchema = {
  id: 'string',
  title: 'string',
  description: 'string',
  tags: 'string[]',
  slug: 'string',
  summary: 'string',
  content: 'string',
};

/**
 * 解析 MDX 文件的 frontmatter
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { data: {}, content };

  const frontmatter = match[1];
  const data = {};

  frontmatter.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length) {
      let value = valueParts.join(':').trim();
      // 移除引号
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      // 解析数组
      if (value.startsWith('[') && value.endsWith(']')) {
        data[key.trim()] = value.slice(1, -1).split(',').map(s => s.trim().replace(/"/g, ''));
      } else {
        data[key.trim()] = value;
      }
    }
  });

  return { data, content: content.slice(match[0].length) };
}

/**
 * 调用智谱 API 生成摘要
 * 注意：需要配置 ZHIPU_API_KEY 环境变量
 */
async function generateSummaryWithAI(title, content) {
  const apiKey = process.env.ZHIPU_API_KEY;

  if (!apiKey) {
    console.log('⚠️  ZHIPU_API_KEY 未配置，跳过 AI 摘要生成');
    return null;
  }

  try {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'GLM-4.7-Flash',
        messages: [
          {
            role: 'system',
            content: '你是一个博客摘要生成助手。请根据文章标题和内容，生成一段简洁的摘要（50-100字），用于 SEO 和文章预览。'
          },
          {
            role: 'user',
            content: `标题：${title}\n\n内容：${content.slice(0, 2000)}`
          }
        ],
        max_tokens: 8192,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} - ${JSON.stringify(data).slice(0, 200)}`);
    }
    if (!data.choices || !data.choices[0]) {
      console.log(`❌ API 返回格式异常: ${JSON.stringify(data).slice(0, 300)}`);
      return null;
    }
    const msg = data.choices[0].message;
    // 推理模型：content 为最终回答，reasoning_content 为思考过程
    // 如果 content 为空，说明推理未完成，增大 token 或换非推理模型
    if (msg?.content) {
      return msg.content.trim();
    }
    console.log(`❌ API content 为空 (finish_reason=${data.choices[0].finish_reason})，推理未完成或模型返回异常`);
    return null;
  } catch (error) {
    console.log(`❌ AI 摘要生成失败: ${error.message}`);
    return null;
  }
}

/**
 * 调用智谱 API 生成 Hero 图片提示词
 */
async function generateImagePrompt(title, summary) {
  const apiKey = process.env.ZHIPU_API_KEY;

  if (!apiKey) {
    console.log('⚠️  ZHIPU_API_KEY 未配置，跳过提示词生成');
    return null;
  }

  const systemPrompt = `# Role
你是一位精通极简主义美学和 AI 绘画提示词工程的专业专家。你的任务是根据用户提供的【博客文章摘要】，生成适用于 Stable Diffusion 的英文绘图提示词（Prompt）。

# Goal
生成的图片将作为博客的 Hero Image（头图），必须满足以下核心要求：
1. **极简风格 (Minimalist)**：画面干净、留白充足、无杂乱细节。
2. **适合排版**：必须预留大量的"负空间"（Negative Space），以便后续在图片上叠加标题文字。
3. **抽象与隐喻**：不要直接描绘具体场景，而是提取文章的核心概念，用抽象几何、光影、单一物体或自然元素来隐喻主题。
4. **高质量**：具备电影级光照、高分辨率、柔和色调。

# Workflow
1. **分析摘要**：理解文章的核心情绪、主题和关键词。
2. **视觉转化**：将抽象概念转化为具体的视觉元素（例如："效率"转化为"简洁的线条"或"光滑的石块"；"焦虑"转化为"混乱但受控的阴影"）。
3. **构建提示词**：按照标准结构组合英文提示词。

# Output Format Structure
请严格遵循以下结构生成英文 Prompt，不要包含任何解释性文字，只输出最终的 Prompt 字符串：

[主体描述], [极简风格修饰词], [构图与留白强调], [光影与色彩], [渲染质量参数]

# Key Vocabulary Guidelines (必须包含以下类型的词汇)
- **风格**: minimalist, clean, simple geometry, abstract, zen, bauhaus, scandinavian design.
- **构图**: vast negative space, uncluttered background, centered composition, wide angle, empty space for text.
- **光影**: soft lighting, diffuse light, cinematic lighting, pastel tones, muted colors, high key.
- **质量**: 8k, highly detailed, photorealistic, octane render, unreal engine 5.

# Constraints
- **语言**：最终输出的 Prompt 必须是**英文**。
- **禁止**：不要在画面中包含文字、水印、复杂的人群、杂乱的背景。
- **比例**：图片尺寸为 16:9 横向。

# Example
User Input: "这篇文章讨论了如何在快节奏的工作中保持专注，建议使用番茄工作法。"
Your Output:
A single ripe tomato resting on a clean white minimalist desk, soft shadows, concept of focus and time, vast negative space on the right side, bright natural lighting, pastel red and white tones, hyperrealistic, 8k, clean lines`;

  try {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'GLM-4.7-Flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `标题：${title}\n摘要：${summary}` }
        ],
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} - ${JSON.stringify(data).slice(0, 200)}`);
    }
    if (!data.choices || !data.choices[0]?.message?.content) {
      console.log(`❌ 提示词生成失败: API 返回异常`);
      console.log(`   返回数据: ${JSON.stringify(data).slice(0, 500)}`);
      return null;
    }
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.log(`❌ 提示词生成失败: ${error.message}`);
    return null;
  }
}

/**
 * 调用 SiliconFlow API 生成 Hero 图片
 */
async function generateHeroImage(prompt, slug) {
  const apiKey = process.env.SILICONFLOW_KEY;

  if (!apiKey) {
    console.log('⚠️  SILICONFLOW_KEY 未配置，跳过图片生成');
    return null;
  }

  if (!prompt) {
    console.log('⚠️  提示词为空，跳过图片生成');
    return null;
  }

  try {
    console.log(`   🎨 生成图片中... (提示词: ${prompt.slice(0, 50)}...)`);

    const response = await fetch('https://api.siliconflow.cn/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'Kwai-Kolors/Kolors',
        prompt: prompt,
        image_size: '1024x1024',
        batch_size: 1,
        num_inference_steps: 20,
        guidance_scale: 7.5,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} - ${JSON.stringify(data).slice(0, 200)}`);
    }

    if (!data.images || !data.images[0]?.url) {
      console.log(`❌ 图片生成失败: API 返回格式异常`);
      return null;
    }

    const imageUrl = data.images[0].url;
    console.log(`   📥 下载图片: ${imageUrl}`);

    // 下载图片
    const imgResponse = await fetch(imageUrl);
    if (!imgResponse.ok) {
      throw new Error(`下载图片失败: ${imgResponse.status}`);
    }

    const arrayBuffer = await imgResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 保存到 public/images/hero/{slug}.png
    const heroPath = path.join(HERO_DIR, `${slug}.png`);
    fs.writeFileSync(heroPath, buffer);

    return `/images/hero/${slug}.png`;
  } catch (error) {
    console.log(`❌ 图片生成失败: ${error.message}`);
    return null;
  }
}

/**
 * 检查 Hero 图片是否已存在
 */
function checkHeroImageExists(slug) {
  const heroPath = path.join(HERO_DIR, `${slug}.png`);
  return fs.existsSync(heroPath);
}

/**
 * 构建搜索索引
 */
async function buildSearchIndex(posts) {
  console.log('🔍 构建搜索索引...');

  const db = await create({
    schema: searchSchema,
    components: {
      tokenizer: {
        // 使用增强分词器支持中英文前缀匹配
        tokenize,
      },
    },
  });

  for (const post of posts) {
    await insert(db, {
      id: post.slug,
      title: post.title,
      description: post.description,
      tags: post.tags || [],
      slug: post.slug,
      summary: post.summary || '',
      content: post.content.slice(0, 2000), // 增加到2000字符用于搜索
    });
  }

  // 保存索引
  const indexData = await save(db);
  fs.writeFileSync(SEARCH_INDEX_PATH, JSON.stringify(indexData, null, 2));

  console.log(`✅ 搜索索引已更新: ${posts.length} 篇文章`);
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 开始 AI 预处理...\n');

  // 确保 hero 图片目录存在
  if (!fs.existsSync(HERO_DIR)) {
    fs.mkdirSync(HERO_DIR, { recursive: true });
  }

  // 从 content-repo 同步内容（本地开发）
  if (fs.existsSync(CONTENT_REPO_PATH)) {
    console.log('📁 从 content-repo 同步内容...');
    syncFromContentRepo();
    console.log('');
  }

  // 检查 content 目录
  if (!fs.existsSync(CONTENT_DIR)) {
    console.log('⚠️  content/posts/ 目录不存在，跳过 AI 预处理');
    return;
  }

  // 读取所有 MDX 文件
  const files = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith('.mdx'));

  if (files.length === 0) {
    console.log('⚠️  没有找到 MDX 文件');
    return;
  }

  console.log(`📄 找到 ${files.length} 篇文章\n`);

  const posts = [];

  for (const file of files) {
    const filePath = path.join(CONTENT_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data, content: body } = parseFrontmatter(content);

    const slug = file.replace('.mdx', '');
    const title = data.title || slug;
    const description = data.description || '';
    const tags = data.tags || [];

    console.log(`📝 处理: ${title}`);

    // 自动注入 updatedDate：用 git log 获取文件最后提交时间
    if (!data.updatedDate) {
      try {
        // CI 环境：content-repo checkout 到 content-repo/ 子目录
        // 本地开发：content-repo 在 ../content-repo/
        const contentRepoDir = path.join(ROOT_DIR, 'content-repo');
        const gitCwd = fs.existsSync(path.join(contentRepoDir, '.git')) ? contentRepoDir : ROOT_DIR;
        const gitPath = gitCwd === contentRepoDir
          ? `content/posts/${file}`
          : `content-repo/content/posts/${file}`;
        const gitDate = execSync(
          `git log -1 --format="%aI" -- ${gitPath}`,
          { encoding: 'utf-8', cwd: gitCwd }
        ).trim();
        if (gitDate) {
          const dateStr = gitDate.slice(0, 10);
          const updatedContent = content.replace(
            /^---\n/,
            `---\nupdatedDate: ${dateStr}\n`
          );
          fs.writeFileSync(filePath, updatedContent);
          data.updatedDate = gitDate;
          console.log(`   📅 注入 updatedDate: ${dateStr}`);
        }
      } catch (e) {
        // git log 失败（本地无 git）则忽略
      }
    }

    // 生成 AI 摘要
    let summary = data.summary;
    const aiSummary = await generateSummaryWithAI(title, body);
    if (aiSummary) {
      summary = aiSummary;
      console.log(`   🤖 AI 摘要: ${summary.slice(0, 50)}...`);
      // 写回 MDX frontmatter，让 Astro content collection 能读到
      let fileContent = fs.readFileSync(filePath, 'utf-8');
      fileContent = fileContent.replace(
        /^---\n/,
        `---\nsummary: "${aiSummary.replace(/"/g, '\\"').replace(/\n/g, ' ')}"\n`
      );
      fs.writeFileSync(filePath, fileContent);
    }

    // 生成 Hero 图片
    let heroImage = data.heroImage;
    const hasCustomHero = heroImage && !heroImage.startsWith('/images/hero/');
    const heroExists = checkHeroImageExists(slug);

    if (!hasCustomHero && !heroExists) {
      // 根据摘要生成图片提示词
      const imagePrompt = await generateImagePrompt(title, summary || description);
      if (imagePrompt) {
        console.log(`   📝 图片提示词: ${imagePrompt.slice(0, 60)}...`);
        // 生成图片
        const heroPath = await generateHeroImage(imagePrompt, slug);
        if (heroPath) {
          heroImage = heroPath;
          console.log(`   ✅ Hero 图片已生成: ${heroPath}`);
          // 写回 MDX frontmatter
          let fileContent = fs.readFileSync(filePath, 'utf-8');
          fileContent = fileContent.replace(
            /^---\n/,
            `---\nheroImage: "${heroPath}"\n`
          );
          fs.writeFileSync(filePath, fileContent);
        }
      }
    } else if (heroExists && !heroImage) {
      // 图片已存在但 frontmatter 没有，补上
      heroImage = `/images/hero/${slug}.png`;
      let fileContent = fs.readFileSync(filePath, 'utf-8');
      fileContent = fileContent.replace(
        /^---\n/,
        `---\nheroImage: "${heroImage}"\n`
      );
      fs.writeFileSync(filePath, fileContent);
      console.log(`   🖼️  使用已存在的 Hero 图片: ${heroImage}`);
    } else if (hasCustomHero) {
      console.log(`   🖼️  使用自定义 Hero 图片: ${heroImage}`);
    } else if (heroExists) {
      console.log(`   🖼️  Hero 图片已存在，跳过生成`);
    }

    posts.push({
      slug,
      title,
      description,
      tags,
      summary,
      heroImage,
      content: body,
      aiGenerated: !!aiSummary,
    });
  }

  // 构建搜索索引
  await buildSearchIndex(posts);

  console.log('\n✨ AI 预处理完成!');
}

main().catch(console.error);