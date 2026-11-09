"use strict";

(() => {
  const elements = {
    endpoint: document.querySelector("#endpoint"),
    chunkSize: document.querySelector("#chunk-size"),
    concurrency: document.querySelector("#concurrency"),
    fileField: document.querySelector("#file-field"),
    selectFile: document.querySelector("#select-file"),
    fileInput: document.querySelector("#file-input"),
    selectedFile: document.querySelector("#selected-file"),
    fileName: document.querySelector("#file-name"),
    fileMeta: document.querySelector("#file-meta"),
    removeFile: document.querySelector("#remove-file"),
    start: document.querySelector("#start-upload"),
    cancel: document.querySelector("#cancel-upload"),
    formMessage: document.querySelector("#form-message"),
    status: document.querySelector("#upload-status"),
    percent: document.querySelector("#progress-percent"),
    detail: document.querySelector("#progress-detail"),
    progress: document.querySelector("#progress-bar"),
    sentSize: document.querySelector("#sent-size"),
    chunkCount: document.querySelector("#chunk-count"),
    elapsed: document.querySelector("#elapsed-time"),
    chunkTotal: document.querySelector("#chunk-total"),
    chunkList: document.querySelector("#chunk-list"),
  };

  let selectedFile = null;
  let uploadTask = null;
  let elapsedTimer = null;

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KiB", "MiB", "GiB", "TiB"];
    let value = bytes / 1024;
    let unit = units[0];
    for (let index = 1; value >= 1024 && index < units.length; index += 1) {
      value /= 1024;
      unit = units[index];
    }
    return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
  };

  const setStatus = (text, modifier = "idle") => {
    elements.status.textContent = text;
    elements.status.className = `status-badge status-${modifier}`;
  };

  const createUploadId = () => (
    window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );

  const setSelectedFile = (file) => {
    selectedFile = file;
    elements.selectedFile.hidden = !file;
    elements.fileName.textContent = file ? file.name : "";
    elements.fileMeta.textContent = file
      ? `${formatBytes(file.size)} · ${file.type || "未知类型"}`
      : "";
    elements.start.disabled = !file || Boolean(uploadTask);
    elements.formMessage.textContent = "";
    if (!uploadTask) {
      elements.detail.textContent = file
        ? "文件已就绪，配置接口后开始上传"
        : "选择文件并配置接口后开始";
    }
  };

  const setChunkState = (chunk, state, statusCode = "—", response = "") => {
    chunk.status.textContent = state;
    chunk.status.className = `chunk-status ${state === "上传中" ? "uploading" : state === "完成" ? "done" : state === "失败" ? "failed" : ""}`;
    chunk.http.textContent = String(statusCode);
    chunk.response.textContent = response;
  };

  const renderChunks = (task) => {
    elements.chunkList.replaceChildren();
    task.chunks.forEach((chunk) => {
      const row = document.createElement("tr");
      const indexCell = document.createElement("td");
      const sizeCell = document.createElement("td");
      const stateCell = document.createElement("td");
      const httpCell = document.createElement("td");
      const responseCell = document.createElement("td");
      const state = document.createElement("span");

      indexCell.textContent = `${chunk.index + 1} / ${task.chunks.length}`;
      sizeCell.textContent = formatBytes(chunk.size);
      state.className = "chunk-status";
      responseCell.className = "response-cell";
      stateCell.append(state);
      row.append(indexCell, sizeCell, stateCell, httpCell, responseCell);
      elements.chunkList.append(row);

      chunk.status = state;
      chunk.http = httpCell;
      chunk.response = responseCell;
      setChunkState(chunk, "等待中");
    });
    elements.chunkTotal.textContent = `${task.chunks.length} 个分片`;
  };

  const updateProgress = (task) => {
    const sent = task.loaded.reduce((total, value) => total + value, 0);
    const percent = task.file.size === 0
      ? (task.doneCount === task.chunks.length ? 100 : 0)
      : Math.min(100, Math.floor((sent / task.file.size) * 100));
    elements.progress.value = percent;
    elements.percent.textContent = `${percent}%`;
    elements.sentSize.textContent = `${formatBytes(sent)} / ${formatBytes(task.file.size)}`;
    elements.chunkCount.textContent = `${task.doneCount} / ${task.chunks.length}`;
    const remaining = task.chunks.length - task.doneCount;
    elements.detail.textContent = task.finished
      ? "所有分片均已成功响应"
      : `正在上传 · ${remaining} 个分片待完成`;
  };

  const stopRequests = (task) => {
    task.requests.forEach((request) => request.abort());
  };

  const sendChunk = (task, chunk) => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const body = new FormData();
    const blob = task.file.slice(chunk.start, chunk.end);
    const field = task.fileField;

    body.append(field, blob, task.file.name);
    body.append("chunkIndex", String(chunk.index));
    body.append("totalChunks", String(task.chunks.length));
    body.append("uploadId", task.uploadId);
    body.append("fileName", task.file.name);
    body.append("fileSize", String(task.file.size));
    body.append("chunkSize", String(chunk.size));

    task.requests.add(request);
    setChunkState(chunk, "上传中");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        task.loaded[chunk.index] = Math.min(
          chunk.size,
          Math.round((chunk.size * event.loaded) / event.total),
        );
        updateProgress(task);
      }
    });
    request.addEventListener("load", () => {
      task.requests.delete(request);
      task.loaded[chunk.index] = chunk.size;
      const response = request.responseText.slice(0, 300);
      if (request.status >= 200 && request.status < 300) {
        task.doneCount += 1;
        setChunkState(chunk, "完成", request.status, response || "（空响应）");
        updateProgress(task);
        resolve();
      } else {
        setChunkState(chunk, "失败", request.status, response || request.statusText || "请求失败");
        reject(new Error(`分片 ${chunk.index + 1} 上传失败，HTTP ${request.status}`));
      }
    });
    request.addEventListener("error", () => {
      task.requests.delete(request);
      setChunkState(chunk, "失败", request.status || "网络错误", "请检查接口地址、网络及 CORS 配置");
      reject(new Error(`分片 ${chunk.index + 1} 网络请求失败`));
    });
    request.addEventListener("abort", () => {
      task.requests.delete(request);
      if (chunk.status.textContent === "上传中") {
        setChunkState(chunk, "已取消", request.status || "—");
      }
      reject(new Error("上传已取消"));
    });
    request.open("POST", task.endpoint);
    request.send(body);
  });

  const startUpload = async () => {
    const endpoint = elements.endpoint.value.trim();
    let endpointUrl;
    try {
      endpointUrl = new URL(endpoint);
    } catch {
      elements.formMessage.textContent = "请输入有效的接口地址。";
      elements.endpoint.focus();
      return;
    }
    if (endpointUrl.protocol !== "http:" && endpointUrl.protocol !== "https:") {
      elements.formMessage.textContent = "接口地址必须使用 HTTP 或 HTTPS。";
      elements.endpoint.focus();
      return;
    }
    if (!selectedFile) return;

    const chunkSizeMiB = Number(elements.chunkSize.value);
    const concurrency = Number(elements.concurrency.value);
    const fileField = elements.fileField.value.trim();
    if (!Number.isInteger(chunkSizeMiB) || chunkSizeMiB < 1 || chunkSizeMiB > 1024) {
      elements.formMessage.textContent = "分片大小须为 1–1024 MiB 的整数。";
      elements.chunkSize.focus();
      return;
    }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
      elements.formMessage.textContent = "并发数须为 1–16 的整数。";
      elements.concurrency.focus();
      return;
    }
    if (!fileField) {
      elements.formMessage.textContent = "文件字段名不能为空。";
      elements.fileField.focus();
      return;
    }
    if (["chunkIndex", "totalChunks", "uploadId", "fileName", "fileSize", "chunkSize"].includes(fileField)) {
      elements.formMessage.textContent = "文件字段名不能与分片元数据字段重名。";
      elements.fileField.focus();
      return;
    }

    const bytesPerChunk = chunkSizeMiB * 1024 * 1024;
    const total = Math.max(1, Math.ceil(selectedFile.size / bytesPerChunk));
    const task = {
      endpoint: endpointUrl.href,
      file: selectedFile,
      fileField,
      uploadId: createUploadId(),
      chunks: Array.from({ length: total }, (_, index) => {
        const start = index * bytesPerChunk;
        const end = Math.min(start + bytesPerChunk, selectedFile.size);
        return { index, start, end, size: end - start };
      }),
      loaded: Array(total).fill(0),
      doneCount: 0,
      requests: new Set(),
      nextChunk: 0,
      cancelled: false,
      failure: null,
      finished: false,
      startedAt: Date.now(),
    };
    uploadTask = task;
    elements.formMessage.textContent = "";
    elements.start.disabled = true;
    elements.cancel.hidden = false;
    elements.selectFile.disabled = true;
    elements.removeFile.disabled = true;
    elements.endpoint.disabled = true;
    elements.chunkSize.disabled = true;
    elements.concurrency.disabled = true;
    elements.fileField.disabled = true;
    elements.progress.value = 0;
    elements.percent.textContent = "0%";
    elements.sentSize.textContent = `0 B / ${formatBytes(task.file.size)}`;
    elements.chunkCount.textContent = `0 / ${total}`;
    elements.elapsed.textContent = "0 秒";
    setStatus("上传中", "running");
    renderChunks(task);
    updateProgress(task);

    elapsedTimer = window.setInterval(() => {
      elements.elapsed.textContent = `${((Date.now() - task.startedAt) / 1000).toFixed(1)} 秒`;
    }, 100);

    const worker = async () => {
      while (!task.cancelled && !task.failure) {
        const index = task.nextChunk;
        task.nextChunk += 1;
        if (index >= task.chunks.length) return;
        try {
          await sendChunk(task, task.chunks[index]);
        } catch (error) {
          if (!task.cancelled && !task.failure) {
            task.failure = error;
            stopRequests(task);
          }
          return;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, total) }, () => worker()),
    );
    window.clearInterval(elapsedTimer);
    elapsedTimer = null;
    elements.elapsed.textContent = `${((Date.now() - task.startedAt) / 1000).toFixed(1)} 秒`;
    task.finished = true;

    if (task.cancelled) {
      setStatus("已取消", "cancelled");
      elements.detail.textContent = "上传已取消";
    } else if (task.failure) {
      setStatus("上传失败", "error");
      elements.detail.textContent = task.failure.message;
    } else {
      elements.progress.value = 100;
      elements.percent.textContent = "100%";
      setStatus("上传完成", "success");
      elements.detail.textContent = "所有分片均已成功响应";
    }
    elements.cancel.hidden = true;
    elements.selectFile.disabled = false;
    elements.removeFile.disabled = false;
    elements.endpoint.disabled = false;
    elements.chunkSize.disabled = false;
    elements.concurrency.disabled = false;
    elements.fileField.disabled = false;
    elements.start.disabled = !selectedFile;
    uploadTask = null;
  };

  elements.selectFile.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", () => {
    setSelectedFile(elements.fileInput.files[0] || null);
  });
  elements.removeFile.addEventListener("click", () => {
    elements.fileInput.value = "";
    setSelectedFile(null);
  });
  elements.start.addEventListener("click", startUpload);
  elements.cancel.addEventListener("click", () => {
    if (!uploadTask) return;
    uploadTask.cancelled = true;
    stopRequests(uploadTask);
    setStatus("正在取消", "cancelled");
  });

  elements.selectFile.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.selectFile.classList.add("is-dragging");
  });
  elements.selectFile.addEventListener("dragleave", () => {
    elements.selectFile.classList.remove("is-dragging");
  });
  elements.selectFile.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.selectFile.classList.remove("is-dragging");
    const file = event.dataTransfer.files[0];
    if (file) {
      elements.fileInput.files = event.dataTransfer.files;
      setSelectedFile(file);
    }
  });
})();
