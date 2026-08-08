#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

let baseUrl = (process.env.KAWAII_IMAGE_BASE_URL || 'https://kawaii.ren').replace(/\/+$/, '');
let activeToken = process.env.KAWAII_IMAGE_API_TOKEN || '';
const CONFIG_DIR = path.join(os.homedir(), '.kawaii-image');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const FLAG_KEYS = new Set([
  'wait',
  'help',
]);

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

class CliError extends Error {}

function parseArgs(argv) {
  const rawCommand = argv[0] || 'help';
  const command = rawCommand === '--help' || rawCommand === '-h' ? 'help' : rawCommand;
  const positional = [];
  const options = {};

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eqIndex = arg.indexOf('=');
    const key = eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2);
    if (eqIndex >= 0) {
      addOption(options, key, arg.slice(eqIndex + 1));
      continue;
    }
    if (!FLAG_KEYS.has(key) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      addOption(options, key, argv[i + 1]);
      i += 1;
    } else {
      addOption(options, key, true);
    }
  }

  return { command, positional, options };
}

function addOption(options, key, value) {
  if (Object.hasOwn(options, key)) {
    const current = options[key];
    options[key] = Array.isArray(current) ? [...current, value] : [current, value];
  } else {
    options[key] = value;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : (value === undefined ? [] : [value]);
}

async function request(apiPath, { method = 'GET', json, form } = {}) {
  const headers = {};
  if (activeToken) headers.Authorization = `Bearer ${activeToken}`;

  let body;
  if (form) {
    body = form;
  } else if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }

  let res;
  try {
    res = await fetch(`${baseUrl}${apiPath}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    throw new CliError(`请求失败：${err.message}`);
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new CliError(`响应解析失败：HTTP ${res.status}`);
  }

  if (!res.ok || payload.code !== 0) {
    const err = new CliError(payload.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload.data;
}

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeConfig(config) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

async function clearConfig() {
  await fs.rm(CONFIG_FILE, { force: true });
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'darwin') {
    const child = spawn('open', [url], { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  }
  if (platform === 'linux') {
    const child = spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  }
  if (platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  }
  return false;
}

async function runLogin() {
  const state = crypto.randomBytes(24).toString('hex');
  const server = http.createServer();
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  function closeLoginServer() {
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
    server.close();
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.unref?.();
  }

  const params = new URLSearchParams({
    client_name: 'kawaii-cli',
    redirect_uri: redirectUri,
    state,
  });

  const startRes = await fetch(`${baseUrl}/api/v1/auth/start?${params.toString()}`);
  const startPayload = await startRes.json();
  if (!startRes.ok || startPayload.code !== 0) {
    throw new CliError(startPayload.message || '无法获取授权地址');
  }

  const authorizationUrl = startPayload.data.authorizationUrl;
  console.log(`请在浏览器中完成授权：\n${authorizationUrl}`);
  if (!openBrowser(authorizationUrl)) {
    console.error('无法自动打开浏览器，请手动访问上面的授权地址。');
  }

  const token = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      closeLoginServer();
      reject(new CliError('授权等待超时'));
    }, 5 * 60 * 1000);

    server.on('request', async (req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const url = new URL(req.url, redirectUri);
      const code = url.searchParams.get('code') || '';
      const receivedState = url.searchParams.get('state') || '';
      if (receivedState !== state || !code) {
        res.writeHead(400);
        res.end('授权失败：state 不匹配');
        clearTimeout(timeout);
        closeLoginServer();
        reject(new CliError('授权失败：state 不匹配'));
        return;
      }
      try {
        const data = await request('/api/v1/auth/exchange', {
          method: 'POST',
          json: { code, state, redirect_uri: redirectUri },
        });
        clearTimeout(timeout);
        await writeConfig({ baseUrl, token: data.token });
        activeToken = data.token;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>授权成功，可以关闭此窗口。</p>');
        res.on('finish', () => {
          closeLoginServer();
          resolve(data.token);
        });
      } catch (err) {
        clearTimeout(timeout);
        res.writeHead(500);
        res.end('授权失败，请重试');
        closeLoginServer();
        reject(err);
      }
    });
  });

  return token;
}

function resolveUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${baseUrl}${url.startsWith('/') ? url : `/${url}`}`;
}

function printJson(data) {
  console.log(JSON.stringify(data ?? null, null, 2));
}

async function uploadFiles(filePaths) {
  const form = new FormData();
  for (const filePath of filePaths) {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new CliError(`不是文件：${filePath}`);
    const mimeType = MIME_BY_EXT[path.extname(filePath).toLowerCase()];
    if (!mimeType) throw new CliError(`不支持的图片格式：${filePath}`);
    const buffer = await fs.readFile(filePath);
    form.append('images', new Blob([buffer], { type: mimeType }), path.basename(filePath));
  }
  return request('/api/v1/uploads', { method: 'POST', form });
}

async function resolveRefs(rawRefs) {
  const refs = asArray(rawRefs).filter(Boolean);
  const localPaths = [];
  const fileKeys = [];
  for (const ref of refs) {
    try {
      const stat = await fs.stat(ref);
      if (stat.isFile()) {
        localPaths.push(ref);
      } else {
        fileKeys.push(ref);
      }
    } catch {
      fileKeys.push(ref);
    }
  }
  if (localPaths.length === 0) return fileKeys;
  const uploaded = await uploadFiles(localPaths);
  return [...uploaded.paths, ...fileKeys];
}

function isTerminal(status) {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

async function waitForTask(taskUuid, timeoutSeconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const res = await fetch(`${baseUrl}/api/v1/tasks/${taskUuid}/stream`, {
      headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {},
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      throw new CliError(`SSE 连接失败：HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let task = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        const payload = JSON.parse(data);
        if (event === 'snapshot') task = payload;
        if (event === 'task.update' && task) task = { ...task, status: payload.status };
        if (event === 'terminal') {
          clearTimeout(timer);
          return request(`/api/v1/tasks/${taskUuid}`);
        }
      }
    }

    if (task && isTerminal(task.status)) return task;
    try {
      return await request(`/api/v1/tasks/${taskUuid}`);
    } catch (err) {
      throw new CliError(`SSE 连接已结束，任务重查失败：${err.message}`);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new CliError(`等待超时（${timeoutSeconds} 秒），任务仍在处理中`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadTask(task, outputPath) {
  if (task.status !== 'completed' || !task.download_url) {
    throw new CliError('任务尚未完成，没有可下载的结果');
  }
  const res = await fetch(resolveUrl(task.download_url));
  if (!res.ok) throw new CliError(`下载失败：HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const target = outputPath || `${task.uuid}.${task.result_file_key.split('.').pop() || 'png'}`;
  await fs.writeFile(target, buffer);
  return target;
}

async function runCapabilities() {
  printJson(await request('/api/v1/capabilities'));
}

async function runModels() {
  printJson(await request('/api/v1/models'));
}

async function runCreate(positional, options) {
  const prompt = options.prompt || positional[0] || '';
  if (!prompt) throw new CliError('请通过 --prompt 提供提示词');

  let model = options.model;
  if (!model) {
    const capabilities = await request('/api/v1/capabilities');
    const models = capabilities.models || [];
    model = models.find((item) => item.isDefault)?.id || models[0]?.id;
    if (!model) throw new CliError('当前组织没有可用的图像模型');
  }

  const refs = await resolveRefs(options.ref);
  const task = await request('/api/v1/tasks', {
    method: 'POST',
    json: {
      prompt,
      model,
      aspectRatio: options['aspect-ratio'],
      imageSize: options['image-size'],
      refs,
    },
  });

  const shouldWait = options.wait === true || Boolean(options.output);
  if (shouldWait) {
    const timeout = Number.isFinite(Number(options.timeout)) ? Number(options.timeout) : 300;
    const finalTask = await waitForTask(task.taskUuid, timeout);
    if (options.output) {
      finalTask.saved_to = await downloadTask(finalTask, options.output);
    }
    printJson(finalTask);
    return;
  }
  printJson(task);
}

async function runStatus(uuid) {
  if (!uuid) throw new CliError('请提供任务 uuid');
  printJson(await request(`/api/v1/tasks/${uuid}`));
}

async function runList(options) {
  const params = new URLSearchParams();
  if (options.page) params.set('page', String(options.page));
  if (options.limit) params.set('limit', String(options.limit));
  if (options.status) params.set('status', options.status);
  if (options.q) params.set('q', options.q);
  const qs = params.toString();
  printJson(await request(`/api/v1/tasks${qs ? `?${qs}` : ''}`));
}

async function runUpload(filePaths) {
  if (filePaths.length === 0) throw new CliError('请提供要上传的图片文件');
  printJson(await uploadFiles(filePaths));
}

async function runRetry(uuid) {
  if (!uuid) throw new CliError('请提供任务 uuid');
  printJson(await request(`/api/v1/tasks/${uuid}/retry`, { method: 'POST' }));
}

async function runCancel(uuid) {
  if (!uuid) throw new CliError('请提供任务 uuid');
  printJson(await request(`/api/v1/tasks/${uuid}/cancel`, { method: 'POST' }));
}

async function runLogout() {
  await clearConfig();
  activeToken = '';
  console.log('已清除本地 API Key');
}

async function runDownload(uuid, options) {
  if (!uuid) throw new CliError('请提供任务 uuid');
  const task = await request(`/api/v1/tasks/${uuid}`);
  const savedTo = await downloadTask(task, options.output);
  printJson({ ...task, saved_to: savedTo });
}

function printHelp() {
  console.log(`kawaii-image 开放 API CLI

环境变量：
  KAWAII_IMAGE_BASE_URL     默认 https://kawaii.ren
  KAWAII_IMAGE_API_TOKEN    可选；登录后自动保存，也可手动设置

命令：
  login                                          浏览器自动授权
  logout                                         清除本地 API Key
  capabilities                                  查看能力、模型和配额
  models                                        查看可用图像模型
  create --prompt "..." [--model uuid] [--ref 文件] [--wait]
  status <taskUuid>                             查看任务状态
  list [--status] [--limit] [--page]            查看任务列表
  upload <file...>                              上传参考图
  retry <taskUuid>                              重试任务
  cancel <taskUuid>                             取消任务
  download <taskUuid> [--output 文件]            下载结果图
  help                                          显示帮助

常用参数：
  --aspect-ratio 1:1
  --image-size 1024
  --timeout 300
  --output ./result.png`);
}

async function main() {
  const { command, positional, options } = parseArgs(process.argv.slice(2));
  const storedConfig = await readConfig();
  if (!process.env.KAWAII_IMAGE_BASE_URL && storedConfig.baseUrl) {
    baseUrl = String(storedConfig.baseUrl).replace(/\/+$/, '');
  }
  if (!activeToken) {
    activeToken = storedConfig.token || '';
  }

  if (command === 'help' || options.help) {
    printHelp();
    return;
  }
  if (command === 'login') {
    await runLogin();
    console.log('登录成功');
    process.exit(0);
  }
  if (command === 'logout') {
    await runLogout();
    return;
  }

  if (!activeToken) {
    console.error('[kawaii-image] 未配置 API Key，开始自动授权...');
    await runLogin();
  }

  switch (command) {
    case 'capabilities':
      await runCapabilities();
      break;
    case 'models':
      await runModels();
      break;
    case 'create':
      await runCreate(positional, options);
      break;
    case 'status':
      await runStatus(positional[0]);
      break;
    case 'list':
      await runList(options);
      break;
    case 'upload':
      await runUpload(positional);
      break;
    case 'retry':
      await runRetry(positional[0]);
      break;
    case 'cancel':
      await runCancel(positional[0]);
      break;
    case 'download':
      await runDownload(positional[0], options);
      break;
    default:
      throw new CliError(`未知命令：${command}`);
  }
}

main().catch((err) => {
  if (err instanceof CliError) {
    console.error(`[kawaii-image] ${err.message}`);
    if (err.status === 402 && err.payload?.errors) {
      const errors = Array.isArray(err.payload.errors)
        ? err.payload.errors
        : (Array.isArray(err.payload.errors?.errors) ? err.payload.errors.errors : []);
      const paidError = errors.find((item) => item.type === 'paid_expired');
      if (paidError?.rechargeUrl) console.error(`续费地址：${paidError.rechargeUrl}`);
    }
  } else {
    console.error('[kawaii-image] 操作失败：', err);
  }
  process.exitCode = 1;
});
