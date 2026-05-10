/**
 * KRIG Knowledge Platform — Upload Service(L5-C6)
 *
 * V1 → V2 直迁:src/main/extraction/upload-service.ts(156 行)。
 * 改动:Platform URL + 凭证抽到 config.ts。
 *
 * 完整流程:
 * 1. POST /api/v1/auth/login → 拿 JWT token(缓存)
 * 2. POST /api/v1/library/upload → multipart form(file + title),拿 md5
 *
 * Token 缓存在内存中,401 → 清缓存自动重新登录。
 */

import fs from 'node:fs';
import path from 'node:path';
import { net } from 'electron';
import { PLATFORM_API, DEFAULT_CREDENTIALS } from './config';

let cachedToken: string | null = null;

export interface UploadResult {
  md5: string;
  fileName: string;
  totalPages: number;
  alreadyExists: boolean;
}

// ── 认证 ──

async function login(): Promise<string> {
  const body = JSON.stringify(DEFAULT_CREDENTIALS);

  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'POST',
      url: `${PLATFORM_API}/auth/login`,
    });
    request.setHeader('Content-Type', 'application/json');

    let responseData = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => {
        responseData += chunk.toString();
      });
      response.on('end', () => {
        if (response.statusCode === 200) {
          try {
            const data = JSON.parse(responseData);
            const token = data.access_token || data.token;
            if (token) {
              cachedToken = token;
              resolve(token);
            } else {
              reject(new Error(`Login response missing token: ${responseData}`));
            }
          } catch {
            reject(new Error(`Invalid login response: ${responseData}`));
          }
        } else {
          reject(new Error(`Login failed: ${response.statusCode} ${responseData}`));
        }
      });
    });
    request.on('error', (err) => reject(new Error(`Login network error: ${err.message}`)));
    request.write(body);
    request.end();
  });
}

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  return login();
}

// ── 上传 ──

/**
 * 上传 PDF 到 Platform。
 * @param filePath PDF 绝对路径
 * @param displayName 用作 multipart 字段 title 与上传文件名(避免 UUID 文件名);
 *                    不传则取 filePath 文件名去 .pdf 后缀
 */
export async function uploadPdfToPlatform(
  filePath: string,
  displayName?: string,
): Promise<UploadResult> {
  const token = await getToken();

  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const title = displayName || fileName.replace(/\.pdf$/i, '');
  console.log(
    `[Upload] File: ${fileName}, title: ${title}, size: ${fileBuffer.length} bytes`,
  );

  if (fileBuffer.length === 0) {
    throw new Error(`File is empty: ${filePath}`);
  }

  const boundary = '----KRIGUpload' + Date.now().toString(36);

  // 用 displayName 作为上传文件名(而非 UUID)
  const uploadFileName = title.endsWith('.pdf') ? title : `${title}.pdf`;

  // multipart body
  const beforeFile = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${uploadFileName}"\r\n` +
      `Content-Type: application/pdf\r\n` +
      `\r\n`,
  );
  const afterFile = Buffer.from(
    `\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="title"\r\n` +
      `\r\n` +
      `${title}` +
      `\r\n` +
      `--${boundary}--\r\n`,
  );

  const body = Buffer.concat([beforeFile, fileBuffer, afterFile]);
  console.log(`[Upload] Body size: ${body.length} bytes (file: ${fileBuffer.length})`);

  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'POST',
      url: `${PLATFORM_API}/library/upload`,
    });

    request.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`);
    request.setHeader('Authorization', `Bearer ${token}`);

    let responseData = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => {
        responseData += chunk.toString();
      });
      response.on('end', () => {
        console.log(
          `[Upload] Response: ${response.statusCode} ${responseData.slice(0, 200)}`,
        );

        if (response.statusCode === 401) {
          // Token 过期 → 清缓存,下次重新登录
          cachedToken = null;
          reject(new Error('Token expired, please retry'));
          return;
        }

        if (response.statusCode === 200 || response.statusCode === 201) {
          try {
            resolve(JSON.parse(responseData) as UploadResult);
          } catch {
            reject(new Error(`Invalid response JSON: ${responseData}`));
          }
        } else {
          reject(new Error(`Upload failed: ${response.statusCode} ${responseData}`));
        }
      });
    });

    request.on('error', (err) => reject(new Error(`Upload network error: ${err.message}`)));

    // 关键:write 整个 body(分段 write 会出问题)
    request.end(body);
  });
}
