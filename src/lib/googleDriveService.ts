/**
 * Google Drive Integration Service for Telecom Dossier Management
 * Supports:
 * - Pre-configured Root Folder ID/URL
 * - Auto-creating subfolder per CSHT (Infrastructure Code)
 * - Uploading JSON reports, HTML summaries, and survey photos via Drive REST API / Apps Script
 * - Fallback to direct Drive folder launcher with packaged dossier
 */

export interface GoogleDriveConfig {
  rootFolderUrl: string; // e.g. https://drive.google.com/drive/folders/1a2b3c...
  rootFolderId: string;  // Extracted folder ID
  accessToken?: string;  // Google OAuth Access Token (optional)
  appsScriptUrl?: string;// Apps Script Web App URL (optional)
}

const STORAGE_KEY = 'telecom_gdrive_config';

export function extractGoogleDriveFolderId(urlOrId: string): string {
  if (!urlOrId) return '';
  const trimmed = urlOrId.trim();
  // If already an ID (alphanumeric, dashes, underscores, typically 25-45 chars)
  if (/^[a-zA-Z0-9_-]{20,50}$/.test(trimmed)) {
    return trimmed;
  }
  // If URL matching /folders/ID
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return match[1];
  }
  // If URL matching id=ID
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch && idMatch[1]) {
    return idMatch[1];
  }
  return trimmed;
}

export function getGoogleDriveConfig(): GoogleDriveConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        rootFolderUrl: parsed.rootFolderUrl || '',
        rootFolderId: extractGoogleDriveFolderId(parsed.rootFolderUrl || parsed.rootFolderId || ''),
        accessToken: parsed.accessToken || '',
        appsScriptUrl: parsed.appsScriptUrl || ''
      };
    }
  } catch (e) {
    console.error('Error reading Google Drive config:', e);
  }
  return {
    rootFolderUrl: '',
    rootFolderId: '',
    accessToken: '',
    appsScriptUrl: ''
  };
}

export function saveGoogleDriveConfig(config: Partial<GoogleDriveConfig>) {
  try {
    const current = getGoogleDriveConfig();
    const updated: GoogleDriveConfig = {
      ...current,
      ...config,
      rootFolderId: extractGoogleDriveFolderId(config.rootFolderUrl || config.rootFolderId || current.rootFolderUrl)
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error('Error saving Google Drive config:', e);
    return null;
  }
}

export interface UploadDossierParams {
  stationCode: string;
  stationName: string;
  folderName: string;
  exportData: Record<string, any>;
  printableHtml?: string;
  photos?: {
    stationPhotoUrl?: string;
    tallestObstaclePhotoUrl?: string;
    antennaPhotos?: { id: string; name: string; url: string }[];
  };
}

export const GOOGLE_APPS_SCRIPT_SAMPLE_CODE = `function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: "Google Apps Script Web App đang hoạt động sẵn sàng kết nối!"
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    
    // Ping check
    if (data.action === "ping") {
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: "Kết nối thành công tới Google Apps Script Web App!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var rootFolderId = data.rootFolderId;
    var folderName = data.folderName;
    var stationCode = data.stationCode || 'CSHT';
    var rootFolder = DriveApp.getFolderById(rootFolderId);
    
    // Tìm hoặc tạo thư mục cho CSHT này
    var folders = rootFolder.getFoldersByName(folderName);
    var targetFolder = folders.hasNext() ? folders.next() : rootFolder.createFolder(folderName);
    
    // 1. Lưu hồ sơ JSON
    if (data.jsonData) {
      var jsonName = stationCode + "_KhaoSat_QCVN08.json";
      var oldJson = targetFolder.getFilesByName(jsonName);
      if (oldJson.hasNext()) oldJson.next().setTrashed(true);
      targetFolder.createFile(jsonName, JSON.stringify(data.jsonData, null, 2), "application/json");
    }

    // 2. Lưu bản in tóm tắt HTML nếu có
    if (data.htmlSummary) {
      var htmlName = stationCode + "_PhuLuc_QCVN08.html";
      var oldHtml = targetFolder.getFilesByName(htmlName);
      if (oldHtml.hasNext()) oldHtml.next().setTrashed(true);
      targetFolder.createFile(htmlName, data.htmlSummary, "text/html");
    }
    
    // 3. Lưu toàn bộ các file ảnh đã chuẩn hóa tên ([MaCSHT]_[LoaiAnh].jpg)
    if (data.files && data.files.length) {
      for (var i = 0; i < data.files.length; i++) {
        var item = data.files[i];
        if (item.contentBase64 && item.filename) {
          var cleanBase64 = item.contentBase64.replace(/^data:image\\/[a-z]+;base64,/, "");
          var decoded = Utilities.base64Decode(cleanBase64);
          var blob = Utilities.newBlob(decoded, "image/jpeg", item.filename);
          var oldFiles = targetFolder.getFilesByName(item.filename);
          if (oldFiles.hasNext()) oldFiles.next().setTrashed(true);
          targetFolder.createFile(blob);
        }
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      folderUrl: targetFolder.getUrl(),
      folderId: targetFolder.getId()
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}`;

/**
 * Ping / test Google Apps Script Web App connection
 */
export async function testGoogleAppsScript(scriptUrl: string): Promise<{ success: boolean; message: string }> {
  if (!scriptUrl || !scriptUrl.startsWith('http')) {
    return { success: false, message: 'URL Apps Script không hợp lệ (cần bắt đầu bằng https://).' };
  }
  try {
    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'ping' })
    });
    const data = await res.json().catch(() => null);
    if (data && data.success) {
      return { success: true, message: data.message || 'Kết nối Apps Script Web App thành công 100%!' };
    }
    return { 
      success: false, 
      message: (data && data.error) ? `Lỗi: ${data.error}` : 'Không nhận được phản hồi JSON hợp lệ từ Apps Script. Vui lòng kiểm tra quyền "Ai có quyền truy cập: Bất kỳ ai" (Anyone).' 
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Không thể kết nối (${err.message || 'Lỗi mạng'}). Hãy đảm bảo bạn đã chọn "Ai có quyền truy cập: Bất kỳ ai" (Anyone) khi Triển khai Web App trên script.google.com.`
    };
  }
}

/**
 * Upload Dossier directly to Google Drive via Drive API or Apps Script
 */
export async function uploadDossierToGoogleDrive(
  config: GoogleDriveConfig,
  params: UploadDossierParams,
  onProgress?: (status: string) => void
): Promise<{ success: boolean; folderUrl: string; folderId?: string; error?: string }> {
  const rootId = config.rootFolderId || extractGoogleDriveFolderId(config.rootFolderUrl) || 'root';

  const cleanStationCode = (params.stationCode || 'CSHT').replace(/[^a-zA-Z0-9_-]/g, '_');

  // Prepare standardized files array
  const standardizedFiles: { filename: string; contentBase64: string }[] = [];
  if (params.photos) {
    if (params.photos.stationPhotoUrl && params.photos.stationPhotoUrl.startsWith('data:image')) {
      standardizedFiles.push({
        filename: `${cleanStationCode}_NhaTram.jpg`,
        contentBase64: params.photos.stationPhotoUrl
      });
    }
    if (params.photos.tallestObstaclePhotoUrl && params.photos.tallestObstaclePhotoUrl.startsWith('data:image')) {
      standardizedFiles.push({
        filename: `${cleanStationCode}_CTCN_CaoNhat.jpg`,
        contentBase64: params.photos.tallestObstaclePhotoUrl
      });
    }
    if (params.photos.antennaPhotos && params.photos.antennaPhotos.length > 0) {
      params.photos.antennaPhotos.forEach((at, idx) => {
        if (at.url && at.url.startsWith('data:image')) {
          standardizedFiles.push({
            filename: `${cleanStationCode}_Anten_AT${idx + 1}.jpg`,
            contentBase64: at.url
          });
        }
      });
    }
  }

  // 1. If Apps Script Web App URL is configured
  if (config.appsScriptUrl) {
    onProgress?.('Đang gửi hồ sơ & ảnh chuẩn hóa qua Google Apps Script...');
    const payload = {
      action: 'saveDossier',
      rootFolderId: rootId,
      folderName: params.folderName,
      stationCode: cleanStationCode,
      jsonData: params.exportData,
      htmlSummary: params.printableHtml || '',
      files: standardizedFiles
    };

    const res = await fetch(config.appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain avoids CORS preflight issues with Apps Script
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success && data.folderUrl) {
      return { success: true, folderUrl: data.folderUrl, folderId: data.folderId };
    }
    throw new Error(data.error || 'Lỗi xử lý tải lên từ Apps Script');
  }

  // 2. If Google Drive Access Token is configured
  if (config.accessToken) {
    onProgress?.(`Đang tạo thư mục "${params.folderName}" trên Google Drive...`);

    // Step A: Search or Create Subfolder in Root Folder
    const token = config.accessToken.trim();
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(params.folderName)}' and '${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name,webViewLink)`;

    let folderId = '';
    let folderUrl = '';

    try {
      const searchRes = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
          folderId = searchData.files[0].id;
          folderUrl = searchData.files[0].webViewLink || `https://drive.google.com/drive/folders/${folderId}`;
        }
      }
    } catch {
      // Continue to create
    }

    if (!folderId) {
      const createFolderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: params.folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [rootId]
        })
      });

      if (!createFolderRes.ok) {
        const errJson = await createFolderRes.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `Lỗi tạo thư mục (${createFolderRes.status})`);
      }

      const createdFolder = await createFolderRes.json();
      folderId = createdFolder.id;
      folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    }

    // Step B: Upload Standardized JSON dossier
    onProgress?.('Đang tải tệp Hồ sơ JSON lên Drive...');
    const jsonBlob = new Blob([JSON.stringify(params.exportData, null, 2)], { type: 'application/json' });
    await uploadFileToDriveFolder(token, folderId, `${cleanStationCode}_KhaoSat_QCVN08.json`, jsonBlob);

    // Step C: Upload HTML summary if provided
    if (params.printableHtml) {
      onProgress?.('Đang tải bản in Phụ lục QCVN 08 (HTML) lên Drive...');
      const htmlBlob = new Blob([params.printableHtml], { type: 'text/html;charset=utf-8' });
      await uploadFileToDriveFolder(token, folderId, `${cleanStationCode}_PhuLuc_QCVN08.html`, htmlBlob);
    }

    // Step D: Upload Standardized Photos [MaCSHT]_[LoaiAnh].jpg
    for (let i = 0; i < standardizedFiles.length; i++) {
      const fileItem = standardizedFiles[i];
      onProgress?.(`Đang tải ảnh "${fileItem.filename}" (${i + 1}/${standardizedFiles.length})...`);
      const blob = dataUrlToBlob(fileItem.contentBase64);
      if (blob) {
        await uploadFileToDriveFolder(token, folderId, fileItem.filename, blob);
      }
    }

    return {
      success: true,
      folderUrl,
      folderId
    };
  }

  throw new Error('Chưa cấu hình mã xác thực Google Drive Token hoặc Apps Script URL. Vui lòng cấu hình tại "Cấu hình Thư mục gốc"!');
}

/**
 * Upload single blob to Drive folder using multipart upload
 */
async function uploadFileToDriveFolder(token: string, folderId: string, fileName: string, blob: Blob) {
  const metadata = {
    name: fileName,
    parents: [folderId]
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.warn(`Lỗi tải tệp ${fileName}:`, err);
  }
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const parts = dataUrl.split(';base64,');
    if (parts.length !== 2) return null;
    const contentType = parts[0].split(':')[1];
    const raw = window.atob(parts[1]);
    const uInt8Array = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], { type: contentType });
  } catch {
    return null;
  }
}
