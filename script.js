document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileListSection = document.getElementById('file-list-section');
    const fileList = document.getElementById('file-list');
    const fileCount = document.getElementById('file-count');
    const actionSection = document.getElementById('action-section');
    const mergeBtn = document.getElementById('merge-btn');

    const convertBtn = document.getElementById('convert-btn');
    const clearBtn = document.getElementById('clear-btn');
    const loadingOverlay = document.getElementById('loading-overlay');
    // Word Conversion Elements
    const wordBtn = document.getElementById('word-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');

    // Nav elements removed
    const previewSection = document.getElementById('preview-section');
    const previewGrid = document.getElementById('preview-grid');
    const downloadZipBtn = document.getElementById('download-zip-btn');

    // Masking Elements
    const maskingModal = document.getElementById('masking-modal');
    const maskDocTitle = document.getElementById('mask-doc-title');
    const maskDocSubtitle = document.getElementById('mask-doc-subtitle');
    const maskPageNav = document.getElementById('mask-page-nav');
    const maskPrevPage = document.getElementById('mask-prev-page');
    const maskNextPage = document.getElementById('mask-next-page');
    const maskPageIndicator = document.getElementById('mask-page-indicator');
    const maskModalClose = document.getElementById('mask-modal-close');
    const maskCancelBtn = document.getElementById('mask-cancel-btn');
    const colorBlackBtn = document.getElementById('color-black-btn');
    const colorWhiteBtn = document.getElementById('color-white-btn');
    const maskUndoBtn = document.getElementById('mask-undo-btn');
    const maskRedoBtn = document.getElementById('mask-redo-btn');
    const maskClearPageBtn = document.getElementById('mask-clear-page-btn');
    const maskZoomOut = document.getElementById('mask-zoom-out');
    const maskZoomIn = document.getElementById('mask-zoom-in');
    const maskZoomFit = document.getElementById('mask-zoom-fit');
    const maskZoomLevel = document.getElementById('mask-zoom-level');
    const maskingWorkspace = document.getElementById('masking-workspace');
    const canvasWrapper = document.getElementById('canvas-wrapper');
    const maskBgCanvas = document.getElementById('mask-bg-canvas');
    const maskInteractiveCanvas = document.getElementById('mask-interactive-canvas');
    const maskCountInfo = document.getElementById('mask-count-info');
    const maskDownloadImgBtn = document.getElementById('mask-download-img-btn');
    const maskDownloadPdfBtn = document.getElementById('mask-download-pdf-btn');
    const maskApplyBtn = document.getElementById('mask-apply-btn');

    // State
    const filesMap = new Map(); // ID -> File object
    let sortableInstance = null;

    // Masking State
    let currentMaskFileId = null;
    let currentMaskFile = null;
    let currentPdfDoc = null;
    let currentTotalPages = 1;
    let currentEditingPage = 1;
    let currentZoom = 1.0;
    let selectedMaskColor = '#000000';
    let masksByPage = {};     // { [pageNum]: Array<{x, y, w, h, color}> }
    let undoStackByPage = {}; // { [pageNum]: Array<Array<mask>> }
    let redoStackByPage = {}; // { [pageNum]: Array<Array<mask>> }
    let isDrawingMask = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let currentDragRect = null;

    // Configure PDF.js Worker (Handle file:// and CORS issues by using Blob)
    const pdfjsWorkerUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // Attempt to load worker via blob to bypass CORS on file protocol if possible
    // If fetch fails (strict blocking), fall back to setting src directly (might fail but best effort)
    fetch(pdfjsWorkerUrl)
        .then(response => {
            if (!response.ok) throw new Error("Worker fetch failed");
            return response.text();
        })
        .then(workerScript => {
            const blob = new Blob([workerScript], { type: 'application/javascript' });
            pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
        })
        .catch(err => {
            console.warn("Could not load worker via Blob, falling back to CDN URL directly. This may cause CORS issues on file:// protocol.", err);
            pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
        });

    // Initialize SortableJS
    initSortable();

    // Event Listeners
    setupDragAndDrop();
    setupFileInput();

    // Nav listeners removed
    mergeBtn.addEventListener('click', mergePDFs);
    convertBtn.addEventListener('click', convertToImages);
    if (wordBtn) wordBtn.addEventListener('click', convertToWord);
    clearBtn.addEventListener('click', clearAllFiles);
    downloadZipBtn.addEventListener('click', downloadAsZip);

    // Setup Masking Modal Listeners
    setupMaskingListeners();

    // Global variable to store zip content for delayed download
    let currentZip = null;

    // SortableJS Initialization
    function initSortable() {
        sortableInstance = new Sortable(fileList, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            filter: '.remove-btn, .mask-btn', // 削除・マスキングボタンではドラッグを開始しない
            preventOnFilter: false, // ボタンのクリックイベントをブロックしない
            onEnd: function (evt) {
                // Determine new order if needed
                console.log('List reordered');
            }
        });
    }

    // Drag and Drop Handling
    function setupDragAndDrop() {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, highlight, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, unhighlight, false);
        });

        function highlight(e) {
            dropZone.classList.add('drag-over');
        }

        function unhighlight(e) {
            dropZone.classList.remove('drag-over');
        }

        dropZone.addEventListener('drop', handleDrop, false);

        // Make entire zone clickable
        dropZone.addEventListener('click', () => {
            fileInput.click();
        });
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        const dt = e.dataTransfer;
        const newFiles = dt.files;
        handleFiles(newFiles);
    }

    // File Input Handling
    function setupFileInput() {
        fileInput.addEventListener('change', function () {
            handleFiles(this.files);
            // Reset input value to allow selecting the same file again if needed
            this.value = '';
        });
    }

    // Process Files
    function handleFiles(files) {
        // Check for PDF or Images by MIME type OR file extension
        const validFiles = Array.from(files).filter(file => {
            const type = file.type;
            const name = file.name.toLowerCase();
            return type === 'application/pdf' || name.endsWith('.pdf') ||
                type === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg') ||
                type === 'image/png' || name.endsWith('.png');
        });

        if (validFiles.length === 0 && files.length > 0) {
            alert('PDFファイルまたは画像ファイル（JPG, PNG）のみアップロード可能です。');
            return;
        }

        validFiles.forEach(addFileToList);
        updateUI();
    }

    function addFileToList(file) {
        const id = generateId();
        filesMap.set(id, file);

        const li = document.createElement('li');
        li.className = 'file-item'; // CSSで cursor: grab を設定済み
        li.dataset.id = id;

        renderFileItemContent(li, id, file);
        fileList.appendChild(li);
    }

    function renderFileItemContent(li, id, file) {
        // Determine icon based on file type
        let iconClass = 'fa-file-pdf';
        if (file.type.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(file.name)) {
            iconClass = 'fa-file-image';
        }

        const editedBadge = file._isMasked
            ? `<span class="edited-badge" title="マスキング編集済み"><i class="fa-solid fa-shield-halved"></i> 編集済</span>`
            : '';

        li.innerHTML = `
            <div class="file-info">
                <i class="fa-solid fa-grip-vertical drag-handle" title="ドラッグして並べ替え"></i>
                <i class="fa-solid ${iconClass} file-icon"></i>
                <div class="file-details">
                    <div style="display: flex; align-items: center; gap: 0.3rem;">
                        <span class="file-name" title="${file.name}">${file.name}</span>
                        ${editedBadge}
                    </div>
                    <span class="file-size">${formatFileSize(file.size)}</span>
                </div>
            </div>
            <div class="file-item-actions">
                <button class="mask-btn" title="個人情報マスキング編集" onclick="openMaskingModal('${id}')">
                    <i class="fa-solid fa-user-shield"></i> マスキング
                </button>
                <button class="remove-btn" title="削除" onclick="removeFile('${id}')">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;
    }

    function updateFileListItem(id) {
        const item = fileList.querySelector(`li[data-id="${id}"]`);
        const file = filesMap.get(id);
        if (item && file) {
            renderFileItemContent(item, id, file);
        }
    }

    // Global function for removing files (called from HTML)
    window.removeFile = function (id) {
        const item = fileList.querySelector(`li[data-id="${id}"]`);
        if (item) {
            // Add fade out animation
            item.style.opacity = '0';
            item.style.transform = 'translateX(20px)';

            setTimeout(() => {
                if (item.parentNode) {
                    item.parentNode.removeChild(item);
                }
                filesMap.delete(id);
                updateUI();
            }, 200);
        }
    };

    // Global function for opening masking modal (called from HTML)
    window.openMaskingModal = function (id) {
        openMaskingEditor(id);
    };

    function clearAllFiles() {
        if (confirm('すべてのファイルを削除しますか？')) {
            fileList.innerHTML = '';
            filesMap.clear();

            // Clear preview as well
            previewGrid.innerHTML = '';
            previewSection.classList.add('hidden');
            currentZip = null;

            updateUI();
        }
    }

    function updateUI() {
        const count = filesMap.size;
        fileCount.textContent = count;

        // Changed elements to target based on new HTML structure
        const fileListColumn = document.getElementById('file-list-column');

        if (count > 0) {
            if (fileListColumn) fileListColumn.classList.remove('hidden');
            actionSection.classList.remove('hidden');
            // Always show both buttons now

            // Optimization: Make upload area compact
            dropZone.classList.add('compact');
        } else {
            if (fileListColumn) fileListColumn.classList.add('hidden');
            actionSection.classList.add('hidden');

            // Restore upload area size
            dropZone.classList.remove('compact');

            // Hide progress
            if (progressContainer) progressContainer.classList.add('hidden');
        }
    }

    function updateProgress(percent, message) {
        if (!progressContainer) return;
        progressContainer.classList.remove('hidden');
        progressBarFill.style.width = `${percent}%`;
        progressText.textContent = message;
    }

    // switchMode function removed

    // PDF Merge Logic
    async function mergePDFs() {
        if (filesMap.size < 2) {
            if (!confirm('ファイルが1つしかありません。結合せずにそのままダウンロードしますか？（通常は2つ以上のファイルを結合します）')) {
                return;
            }
        }

        // Hide preview if exists
        previewSection.classList.add('hidden');

        showLoading(true);

        try {
            const PDFDocument = PDFLib.PDFDocument;
            const mergedPdf = await PDFDocument.create();

            // Iterate through DOM elements to match the user-sorted order
            const items = fileList.querySelectorAll('.file-item');

            for (const item of items) {
                const id = item.dataset.id;
                const file = filesMap.get(id);

                if (file) {
                    const arrayBuffer = await file.arrayBuffer();
                    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                        // Handle PDF
                        const pdf = await PDFDocument.load(arrayBuffer);
                        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
                        copiedPages.forEach((page) => mergedPdf.addPage(page));
                    } else if (file.type.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(file.name)) {
                        // Handle Image
                        let image;
                        if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
                            image = await mergedPdf.embedPng(arrayBuffer);
                        } else { // JPG
                            image = await mergedPdf.embedJpg(arrayBuffer);
                        }

                        // Add page with image size
                        const page = mergedPdf.addPage([image.width, image.height]);
                        page.drawImage(image, {
                            x: 0,
                            y: 0,
                            width: image.width,
                            height: image.height,
                        });
                    }
                }
            }

            const mergedPdfBytes = await mergedPdf.save();
            downloadPDF(mergedPdfBytes, 'merged-document.pdf');

        } catch (error) {
            console.error('PDF Merge Error:', error);
            alert('PDFの結合中にエラーが発生しました。\n' + error.message);
        } finally {
            showLoading(false);
        }
    }

    // PDF Conversion Logic
    async function convertToImages() {
        if (filesMap.size === 0) return;

        showLoading(true);
        previewGrid.innerHTML = ''; // Clear previous results
        previewSection.classList.add('hidden');
        currentZip = null;

        try {
            const zip = new JSZip();
            const imgFolder = zip.folder("images");
            let fileCounter = 1;

            // Sort files by list order
            const items = fileList.querySelectorAll('.file-item');

            for (const item of items) {
                const id = item.dataset.id;
                const file = filesMap.get(id);
                if (!file) continue;

                // Get base name without extension
                const baseName = file.name.replace(/\.[^/.]+$/, "");

                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({ scale: 2.0 }); // High quality
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    await page.render({
                        canvasContext: context,
                        viewport: viewport
                    }).promise;

                    // Use PNG for better quality and compatibility
                    const dataUrl = canvas.toDataURL('image/png');

                    // Remove header to get base64 content
                    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");

                    if (!base64Data) {
                        console.error(`Empty data for File ${fileCounter} Page ${i}`);
                        continue;
                    }

                    // Use Original Filename + Page Number
                    const fileName = `${baseName}_${i}.png`;
                    imgFolder.file(fileName, base64Data, { base64: true });

                    // Add to Preview (Directly add to DOM)
                    addImageToPreview(dataUrl, fileName);
                }
                fileCounter++;
            }

            // Generate ZIP blob and store it for "Download ZIP" button
            const content = await zip.generateAsync({ type: "blob" });
            currentZip = content;

            // Show Preview Section
            previewSection.classList.remove('hidden');

            // Note: We do NOT auto-download the ZIP anymore to avoid blocking
            // The user can click individual download buttons or the ZIP button manually.

        } catch (error) {
            console.error('Image Conversion Error:', error);
            alert('画像の変換中にエラーが発生しました。\n(セキュリティソフト等によりスクリプトの実行がブロックされた可能性があります)\n' + error.message);
        } finally {
            showLoading(false);
        }
    }

    function addImageToPreview(dataUrl, fileName) {
        const card = document.createElement('div');
        card.className = 'image-card';

        card.innerHTML = `
            <img src="${dataUrl}" class="image-preview" alt="${fileName}">
            <div class="card-actions">
                <span class="img-name" title="${fileName}">${fileName}</span>
                <button class="download-single-btn" onclick="downloadSingleImage('${fileName}')">
                    <i class="fa-solid fa-download"></i> 保存
                </button>
            </div>
        `;

        // We need to attach the dataUrl securely to the button or handler. 
        // Using inline onclick with huge base64 string is bad.
        // Let's modify the onclick to call a function relying on looking up the img src.
        const btn = card.querySelector('.download-single-btn');
        btn.onclick = () => downloadDataUrl(dataUrl, fileName);

        previewGrid.appendChild(card);
    }

    function downloadDataUrl(dataUrl, fileName) {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async function downloadAsZip() {
        if (currentZip) {
            downloadPDF(currentZip, "converted-images.zip");
        } else {
            alert("ダウンロード可能なZIPファイルがありません。まずは変換を実行してください。");
        }
    }

    function downloadPDF(bytes, fileName) {
        const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/pdf' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Utilities
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function showLoading(show) {
        if (show) {
            loadingOverlay.classList.remove('hidden');
        } else {
            loadingOverlay.classList.add('hidden');
        }
    }
    // Word Conversion Logic (Text Extraction + OCR)
    async function convertToWord() {
        if (filesMap.size === 0) return;

        // Reset and show progress
        updateProgress(0, '準備中...');
        previewSection.classList.add('hidden');

        // Disable buttons
        mergeBtn.disabled = true;
        convertBtn.disabled = true;
        wordBtn.disabled = true;

        try {
            const paragraphs = [];
            const items = fileList.querySelectorAll('.file-item');
            const totalFiles = items.length;
            let processedCount = 0;

            for (const item of items) {
                const id = item.dataset.id;
                const file = filesMap.get(id);
                if (!file) continue;

                updateProgress((processedCount / totalFiles) * 100, `処理中 (${processedCount + 1}/${totalFiles}): ${file.name}`);

                // Add Filename as Heading
                paragraphs.push(new docx.Paragraph({
                    text: file.name,
                    heading: docx.HeadingLevel.HEADING_1,
                    spacing: { before: 200, after: 100 }
                }));

                if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                    // Extract Text from PDF
                    const arrayBuffer = await file.arrayBuffer();
                    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;

                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();

                        // Simple consolidation of text items
                        const pageText = textContent.items.map(item => item.str).join(' ');

                        if (pageText.trim()) {
                            paragraphs.push(new docx.Paragraph({
                                text: pageText,
                                spacing: { after: 200 }
                            }));
                        }
                    }

                } else if (file.type.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(file.name)) {
                    // OCR for Image
                    updateProgress((processedCount / totalFiles) * 100, `OCR解析中 (${processedCount + 1}/${totalFiles}): ${file.name} - 少々お待ちください...`);

                    // Create Tesseract worker
                    const worker = await Tesseract.createWorker('eng+jpn'); // Detect English and Japanese
                    const ret = await worker.recognize(file);
                    const text = ret.data.text;
                    await worker.terminate();

                    if (text.trim()) {
                        // Split by newlines to respect some formatting
                        const lines = text.split('\n');
                        lines.forEach(line => {
                            if (line.trim()) {
                                paragraphs.push(new docx.Paragraph({
                                    text: line,
                                }));
                            }
                        });
                    } else {
                        paragraphs.push(new docx.Paragraph({
                            text: "[文字を認識できませんでした]",
                            style: "I" // Italic
                        }));
                    }
                }

                processedCount++;
            }

            // Generate Word Document
            updateProgress(90, 'Wordファイルを生成中...');

            const doc = new docx.Document({
                sections: [{
                    properties: {},
                    children: paragraphs,
                }],
            });

            const blob = await docx.Packer.toBlob(doc);
            downloadPDF(blob, 'converted_text.docx'); // Reuse download function

            updateProgress(100, '完了！');
            setTimeout(() => {
                progressContainer.classList.add('hidden');
            }, 3000);

        } catch (error) {
            console.error('Word Conversion Error:', error);
            alert('Word変換中にエラーが発生しました。\n' + error.message);
            progressContainer.classList.add('hidden');
        } finally {
            mergeBtn.disabled = false;
            convertBtn.disabled = false;
            wordBtn.disabled = false;
        }
    }

    // ==========================================================================
    // 個人情報マスキング（墨消し）機能ロジック
    // ==========================================================================

    // イベントリスナーのセットアップ
    function setupMaskingListeners() {
        // 色選択
        colorBlackBtn.addEventListener('click', () => setMaskColor('#000000'));
        colorWhiteBtn.addEventListener('click', () => setMaskColor('#ffffff'));

        // 履歴操作
        maskUndoBtn.addEventListener('click', undoMask);
        maskRedoBtn.addEventListener('click', redoMask);
        maskClearPageBtn.addEventListener('click', clearPageMasks);

        // ズーム操作
        maskZoomIn.addEventListener('click', () => setZoom(currentZoom + 0.15));
        maskZoomOut.addEventListener('click', () => setZoom(currentZoom - 0.15));
        maskZoomFit.addEventListener('click', zoomFit);

        // ページ切り替え
        maskPrevPage.addEventListener('click', () => {
            if (currentEditingPage > 1) {
                loadMaskingPdfPage(currentEditingPage - 1);
            }
        });
        maskNextPage.addEventListener('click', () => {
            if (currentEditingPage < currentTotalPages) {
                loadMaskingPdfPage(currentEditingPage + 1);
            }
        });

        // モーダル閉じる
        maskModalClose.addEventListener('click', closeMaskingModal);
        maskCancelBtn.addEventListener('click', closeMaskingModal);

        // アクション
        maskDownloadImgBtn.addEventListener('click', downloadMaskedImage);
        maskDownloadPdfBtn.addEventListener('click', downloadMaskedPdf);
        maskApplyBtn.addEventListener('click', applyMaskingToFileList);

        // キーボードショートカット
        window.addEventListener('keydown', (e) => {
            if (maskingModal.classList.contains('hidden')) return;

            if (e.key === 'Escape') {
                closeMaskingModal();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                undoMask();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                redoMask();
            }
        });

        // キャンバスのマスキング描画マウスイベント
        maskInteractiveCanvas.addEventListener('mousedown', onCanvasMouseDown);
        window.addEventListener('mousemove', onCanvasMouseMove);
        window.addEventListener('mouseup', onCanvasMouseUp);

        // タッチ操作対応
        maskInteractiveCanvas.addEventListener('touchstart', onCanvasTouchStart, { passive: false });
        window.addEventListener('touchmove', onCanvasTouchMove, { passive: false });
        window.addEventListener('touchend', onCanvasTouchEnd);

        // ワークスペース上でのCtrl+ホイールズーム対応
        maskingWorkspace.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.1 : -0.1;
                setZoom(currentZoom + delta);
            }
        }, { passive: false });
    }

    // マスキングエディタを開く
    async function openMaskingEditor(id) {
        const file = filesMap.get(id);
        if (!file) return;

        currentMaskFileId = id;
        currentMaskFile = file;

        // 既存の保存済みマスクがあれば復元、なければ初期化
        if (file._savedMasks) {
            masksByPage = JSON.parse(JSON.stringify(file._savedMasks));
        } else {
            masksByPage = {};
        }

        undoStackByPage = {};
        redoStackByPage = {};
        currentEditingPage = 1;
        currentZoom = 1.0;
        setMaskColor('#000000');

        // タイトル設定
        maskDocTitle.textContent = `個人情報マスキング編集: ${file.name}`;

        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

        try {
            if (isPdf) {
                showLoading(true);
                const arrayBuffer = await file.arrayBuffer();
                currentPdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
                currentTotalPages = currentPdfDoc.numPages;

                // ページナビゲーションの表示・非表示
                if (currentTotalPages > 1) {
                    maskPageNav.classList.remove('hidden');
                } else {
                    maskPageNav.classList.add('hidden');
                }

                await loadMaskingPdfPage(1);
            } else {
                currentPdfDoc = null;
                currentTotalPages = 1;
                maskPageNav.classList.add('hidden');
                await loadMaskingImagePage();
            }

            maskingModal.classList.remove('hidden');
            document.body.style.overflow = 'hidden'; // 背景スクロール固定

            // 初期表示を画面サイズに自動フィット
            setTimeout(() => {
                zoomFit();
            }, 50);

        } catch (error) {
            console.error('マスキング初期化エラー:', error);
            alert('ファイルの読み込みに失敗しました:\n' + error.message);
        } finally {
            showLoading(false);
        }
    }

    // PDFページの読み込み
    async function loadMaskingPdfPage(pageNum) {
        if (!currentPdfDoc) return;
        showLoading(true);

        try {
            currentEditingPage = pageNum;
            const page = await currentPdfDoc.getPage(pageNum);
            const scale = 2.0; // 高解像度描画
            const viewport = page.getViewport({ scale });

            // キャンバスサイズ同期
            maskBgCanvas.width = viewport.width;
            maskBgCanvas.height = viewport.height;
            maskInteractiveCanvas.width = viewport.width;
            maskInteractiveCanvas.height = viewport.height;

            // 背景PDFレンダリング
            const bgCtx = maskBgCanvas.getContext('2d');
            await page.render({ canvasContext: bgCtx, viewport }).promise;

            // ズーム表示を適用
            setZoom(currentZoom);

            // ページごとの状態初期化
            if (!masksByPage[pageNum]) masksByPage[pageNum] = [];
            if (!undoStackByPage[pageNum]) undoStackByPage[pageNum] = [];
            if (!redoStackByPage[pageNum]) redoStackByPage[pageNum] = [];

            // ページナビゲーション更新
            maskPageIndicator.textContent = `${pageNum} / ${currentTotalPages}`;
            maskPrevPage.disabled = (pageNum <= 1);
            maskNextPage.disabled = (pageNum >= currentTotalPages);

            redrawInteractiveCanvas();
            updateToolbarHistoryState();

        } catch (err) {
            console.error('PDFページ読み込みエラー:', err);
            alert('ページの読み込みに失敗しました:\n' + err.message);
        } finally {
            showLoading(false);
        }
    }

    // 画像ファイルの読み込み
    async function loadMaskingImagePage() {
        showLoading(true);
        try {
            currentEditingPage = 1;
            const img = new Image();
            const url = URL.createObjectURL(currentMaskFile);

            await new Promise((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = reject;
                img.src = url;
            });

            maskBgCanvas.width = img.naturalWidth;
            maskBgCanvas.height = img.naturalHeight;
            maskInteractiveCanvas.width = img.naturalWidth;
            maskInteractiveCanvas.height = img.naturalHeight;

            const bgCtx = maskBgCanvas.getContext('2d');
            bgCtx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);

            // ズーム表示を適用
            setZoom(currentZoom);

            if (!masksByPage[1]) masksByPage[1] = [];
            if (!undoStackByPage[1]) undoStackByPage[1] = [];
            if (!redoStackByPage[1]) redoStackByPage[1] = [];

            redrawInteractiveCanvas();
            updateToolbarHistoryState();

        } catch (err) {
            console.error('画像読み込みエラー:', err);
            alert('画像の読み込みに失敗しました:\n' + err.message);
        } finally {
            showLoading(false);
        }
    }

    // マスク色変更
    function setMaskColor(color) {
        selectedMaskColor = color;
        if (color === '#000000') {
            colorBlackBtn.classList.add('active');
            colorWhiteBtn.classList.remove('active');
        } else {
            colorWhiteBtn.classList.add('active');
            colorBlackBtn.classList.remove('active');
        }
    }

    // ズーム設定（CSS transformではなく実寸スタイルを変更してスクロールを確実に動作させる）
    function setZoom(factor) {
        const oldZoom = currentZoom;
        currentZoom = Math.min(Math.max(0.15, factor), 3.0);
        if (maskBgCanvas.width > 0 && maskBgCanvas.height > 0) {
            const scrollCenterX = maskingWorkspace.scrollLeft + maskingWorkspace.clientWidth / 2;
            const scrollCenterY = maskingWorkspace.scrollTop + maskingWorkspace.clientHeight / 2;

            const displayW = Math.round(maskBgCanvas.width * currentZoom);
            const displayH = Math.round(maskBgCanvas.height * currentZoom);
            canvasWrapper.style.width = `${displayW}px`;
            canvasWrapper.style.height = `${displayH}px`;

            // ズーム比率に合わせてスクロール位置を中心基準で調整（一番上・左にもスムーズに戻れる）
            if (oldZoom > 0 && oldZoom !== currentZoom) {
                const ratio = currentZoom / oldZoom;
                maskingWorkspace.scrollLeft = (scrollCenterX * ratio) - (maskingWorkspace.clientWidth / 2);
                maskingWorkspace.scrollTop = (scrollCenterY * ratio) - (maskingWorkspace.clientHeight / 2);
            }
        }
        canvasWrapper.style.transform = 'none';
        maskZoomLevel.textContent = `${Math.round(currentZoom * 100)}%`;
    }

    // 画面フィットズーム
    function zoomFit() {
        const padding = 80;
        const availableW = maskingWorkspace.clientWidth - padding;
        const availableH = maskingWorkspace.clientHeight - padding;
        if (availableW > 0 && availableH > 0 && maskBgCanvas.width > 0 && maskBgCanvas.height > 0) {
            const scaleX = availableW / maskBgCanvas.width;
            const scaleY = availableH / maskBgCanvas.height;
            const fitZoom = Math.min(scaleX, scaleY, 1.0);
            setZoom(fitZoom);
            // スクロール位置を一番上・左にリセット
            maskingWorkspace.scrollTop = 0;
            maskingWorkspace.scrollLeft = 0;
        }
    }

    // キャンバス座標計算（CSSズーム対応）
    function getCanvasCoordinates(e) {
        const rect = maskInteractiveCanvas.getBoundingClientRect();
        const scaleX = maskInteractiveCanvas.width / rect.width;
        const scaleY = maskInteractiveCanvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const x = (clientX - rect.left) * scaleX;
        const y = (clientY - rect.top) * scaleY;

        return {
            x: Math.max(0, Math.min(maskInteractiveCanvas.width, x)),
            y: Math.max(0, Math.min(maskInteractiveCanvas.height, y))
        };
    }

    // マウス・タッチ操作イベント
    function onCanvasMouseDown(e) {
        if (e.button !== 0) return; // 左クリックのみ
        startDrawingMask(e);
    }

    function onCanvasTouchStart(e) {
        if (e.touches.length === 1) {
            e.preventDefault();
            startDrawingMask(e);
        }
    }

    function startDrawingMask(e) {
        isDrawingMask = true;
        const coords = getCanvasCoordinates(e);
        dragStartX = coords.x;
        dragStartY = coords.y;
        currentDragRect = {
            x: dragStartX,
            y: dragStartY,
            w: 0,
            h: 0,
            color: selectedMaskColor
        };
    }

    function onCanvasMouseMove(e) {
        if (!isDrawingMask) return;
        updateDrawingMask(e);
    }

    function onCanvasTouchMove(e) {
        if (!isDrawingMask) return;
        e.preventDefault();
        updateDrawingMask(e);
    }

    function updateDrawingMask(e) {
        const coords = getCanvasCoordinates(e);
        const x = Math.min(dragStartX, coords.x);
        const y = Math.min(dragStartY, coords.y);
        const w = Math.abs(coords.x - dragStartX);
        const h = Math.abs(coords.y - dragStartY);

        currentDragRect = {
            x,
            y,
            w,
            h,
            color: selectedMaskColor
        };

        redrawInteractiveCanvas();
    }

    function onCanvasMouseUp() {
        if (!isDrawingMask) return;
        finishDrawingMask();
    }

    function onCanvasTouchEnd() {
        if (!isDrawingMask) return;
        finishDrawingMask();
    }

    function finishDrawingMask() {
        isDrawingMask = false;

        // 4px以上の有意な矩形のみ確定（クリックミス防止）
        if (currentDragRect && currentDragRect.w >= 4 && currentDragRect.h >= 4) {
            pushUndoState();
            if (!masksByPage[currentEditingPage]) {
                masksByPage[currentEditingPage] = [];
            }
            masksByPage[currentEditingPage].push(currentDragRect);
            redoStackByPage[currentEditingPage] = []; // 新規操作でRedoクリア
        }

        currentDragRect = null;
        redrawInteractiveCanvas();
        updateToolbarHistoryState();
    }

    // インタラクティブキャンバスの再描画
    function redrawInteractiveCanvas() {
        const ctx = maskInteractiveCanvas.getContext('2d');
        ctx.clearRect(0, 0, maskInteractiveCanvas.width, maskInteractiveCanvas.height);

        const pageMasks = masksByPage[currentEditingPage] || [];

        // 確定済みマスクの描画
        for (const m of pageMasks) {
            ctx.fillStyle = m.color;
            ctx.fillRect(m.x, m.y, m.w, m.h);

            // 境界線の視認性用スタイル
            ctx.strokeStyle = m.color === '#000000' ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.25)';
            ctx.lineWidth = 1;
            ctx.strokeRect(m.x, m.y, m.w, m.h);
        }

        // ドラッグ中のプレビュー描画
        if (currentDragRect) {
            ctx.fillStyle = currentDragRect.color === '#000000' ? 'rgba(0, 0, 0, 0.65)' : 'rgba(255, 255, 255, 0.75)';
            ctx.fillRect(currentDragRect.x, currentDragRect.y, currentDragRect.w, currentDragRect.h);

            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = '#6366f1';
            ctx.lineWidth = 2;
            ctx.strokeRect(currentDragRect.x, currentDragRect.y, currentDragRect.w, currentDragRect.h);
            ctx.setLineDash([]);
        }

        // マスク数表示の更新
        maskCountInfo.textContent = `現在のマスク数: ${pageMasks.length}個 (ページ ${currentEditingPage} / ${currentTotalPages})`;
    }

    // 履歴スタック管理
    function pushUndoState() {
        const list = masksByPage[currentEditingPage] || [];
        if (!undoStackByPage[currentEditingPage]) {
            undoStackByPage[currentEditingPage] = [];
        }
        undoStackByPage[currentEditingPage].push(JSON.parse(JSON.stringify(list)));
    }

    function undoMask() {
        const uStack = undoStackByPage[currentEditingPage];
        if (uStack && uStack.length > 0) {
            const currentList = masksByPage[currentEditingPage] || [];
            if (!redoStackByPage[currentEditingPage]) {
                redoStackByPage[currentEditingPage] = [];
            }
            redoStackByPage[currentEditingPage].push(JSON.parse(JSON.stringify(currentList)));

            masksByPage[currentEditingPage] = uStack.pop();
            redrawInteractiveCanvas();
            updateToolbarHistoryState();
        }
    }

    function redoMask() {
        const rStack = redoStackByPage[currentEditingPage];
        if (rStack && rStack.length > 0) {
            const currentList = masksByPage[currentEditingPage] || [];
            if (!undoStackByPage[currentEditingPage]) {
                undoStackByPage[currentEditingPage] = [];
            }
            undoStackByPage[currentEditingPage].push(JSON.parse(JSON.stringify(currentList)));

            masksByPage[currentEditingPage] = rStack.pop();
            redrawInteractiveCanvas();
            updateToolbarHistoryState();
        }
    }

    function clearPageMasks() {
        const list = masksByPage[currentEditingPage] || [];
        if (list.length === 0) return;

        if (confirm('このページのすべてのマスクを削除しますか？')) {
            pushUndoState();
            masksByPage[currentEditingPage] = [];
            redoStackByPage[currentEditingPage] = [];
            redrawInteractiveCanvas();
            updateToolbarHistoryState();
        }
    }

    function updateToolbarHistoryState() {
        const uStack = undoStackByPage[currentEditingPage] || [];
        const rStack = redoStackByPage[currentEditingPage] || [];
        const list = masksByPage[currentEditingPage] || [];

        maskUndoBtn.disabled = (uStack.length === 0);
        maskRedoBtn.disabled = (rStack.length === 0);
        maskClearPageBtn.disabled = (list.length === 0);
    }

    // モーダルを閉じる
    function closeMaskingModal() {
        maskingModal.classList.add('hidden');
        document.body.style.overflow = '';
        currentDragRect = null;
        isDrawingMask = false;
    }

    // マスクを完全に焼き付けたページCanvasの生成（不可逆ラスタライズ処理）
    async function createFlattenedCanvasForPage(pageNum) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (currentPdfDoc) {
            const page = await currentPdfDoc.getPage(pageNum);
            const scale = 2.0;
            const viewport = page.getViewport({ scale });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: ctx, viewport }).promise;
        } else {
            canvas.width = maskBgCanvas.width;
            canvas.height = maskBgCanvas.height;
            ctx.drawImage(maskBgCanvas, 0, 0);
        }

        // マスク矩形を完全に焼き付け（テキスト情報も完全に除去・遮蔽）
        const pageMasks = masksByPage[pageNum] || [];
        for (const m of pageMasks) {
            ctx.fillStyle = m.color;
            ctx.fillRect(m.x, m.y, m.w, m.h);
        }

        return canvas;
    }

    // マスキング済みPDFのダウンロード
    async function downloadMaskedPdf() {
        if (!currentMaskFile) return;

        showLoading(true);
        try {
            const PDFDocument = PDFLib.PDFDocument;
            const outPdf = await PDFDocument.create();

            for (let p = 1; p <= currentTotalPages; p++) {
                const canvas = await createFlattenedCanvasForPage(p);
                // 高品質JPEGとして埋め込み
                const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
                const binaryStr = atob(base64Data);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                }

                const img = await outPdf.embedJpg(bytes);
                const page = outPdf.addPage([img.width, img.height]);
                page.drawImage(img, {
                    x: 0,
                    y: 0,
                    width: img.width,
                    height: img.height,
                });
            }

            const pdfBytes = await outPdf.save();
            const baseName = currentMaskFile.name.replace(/\.[^/.]+$/, "");
            downloadPDF(pdfBytes, `${baseName}_masked.pdf`);

        } catch (error) {
            console.error('マスキングPDF書き出しエラー:', error);
            alert('PDFの書き出し中にエラーが発生しました:\n' + error.message);
        } finally {
            showLoading(false);
        }
    }

    // マスキング済み画像のダウンロード
    async function downloadMaskedImage() {
        if (!currentMaskFile) return;

        showLoading(true);
        try {
            const canvas = await createFlattenedCanvasForPage(currentEditingPage);
            const baseName = currentMaskFile.name.replace(/\.[^/.]+$/, "");
            const fileName = currentTotalPages > 1
                ? `${baseName}_masked_p${currentEditingPage}.png`
                : `${baseName}_masked.png`;

            downloadDataUrl(canvas.toDataURL('image/png'), fileName);
        } catch (error) {
            console.error('マスキング画像保存エラー:', error);
            alert('画像の保存中にエラーが発生しました:\n' + error.message);
        } finally {
            showLoading(false);
        }
    }

    // マスキング内容をファイルリストに反映
    async function applyMaskingToFileList() {
        if (!currentMaskFile || !currentMaskFileId) return;

        // 全ページでのマスク件数を確認
        let totalMaskCount = 0;
        for (const p in masksByPage) {
            totalMaskCount += (masksByPage[p] || []).length;
        }

        if (totalMaskCount === 0) {
            if (!confirm('マスクが1つも描画されていません。このままリストを更新しますか？')) {
                return;
            }
        }

        showLoading(true);
        try {
            const isPdf = currentPdfDoc !== null;
            let newFile;

            if (isPdf) {
                // PDFの場合、全ページを再構築したPDFドキュメントを生成
                const PDFDocument = PDFLib.PDFDocument;
                const outPdf = await PDFDocument.create();

                for (let p = 1; p <= currentTotalPages; p++) {
                    const canvas = await createFlattenedCanvasForPage(p);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                    const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
                    const binaryStr = atob(base64Data);
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let i = 0; i < binaryStr.length; i++) {
                        bytes[i] = binaryStr.charCodeAt(i);
                    }

                    const img = await outPdf.embedJpg(bytes);
                    const page = outPdf.addPage([img.width, img.height]);
                    page.drawImage(img, {
                        x: 0,
                        y: 0,
                        width: img.width,
                        height: img.height,
                    });
                }

                const pdfBytes = await outPdf.save();
                const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                newFile = new File([blob], currentMaskFile.name, {
                    type: 'application/pdf',
                    lastModified: Date.now()
                });

            } else {
                // 画像の場合
                const canvas = await createFlattenedCanvasForPage(1);
                const mimeType = currentMaskFile.type || 'image/png';
                const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType));
                newFile = new File([blob], currentMaskFile.name, {
                    type: mimeType,
                    lastModified: Date.now()
                });
            }

            // マスキングフラグと再編集用マスクデータを保持
            newFile._isMasked = totalMaskCount > 0;
            newFile._savedMasks = JSON.parse(JSON.stringify(masksByPage));

            // filesMapの該当ファイルを置き換え
            filesMap.set(currentMaskFileId, newFile);

            // リスト表示を更新
            updateFileListItem(currentMaskFileId);

            closeMaskingModal();
            alert(`「${currentMaskFile.name}」のマスキング編集をファイルリストに反映しました。\nPDF結合や画像変換でも編集内容が適用されます。`);

        } catch (error) {
            console.error('マスキング反映エラー:', error);
            alert('ファイルリストへの反映中にエラーが発生しました:\n' + error.message);
        } finally {
            showLoading(false);
        }
    }
});
