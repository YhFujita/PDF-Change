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

    // Nav elements removed
    const previewSection = document.getElementById('preview-section');
    const previewGrid = document.getElementById('preview-grid');
    const downloadZipBtn = document.getElementById('download-zip-btn');

    // State
    const filesMap = new Map(); // ID -> File object
    let sortableInstance = null;
    // Mode state removed

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
    clearBtn.addEventListener('click', clearAllFiles);
    downloadZipBtn.addEventListener('click', downloadAsZip);

    // Global variable to store zip content for delayed download
    let currentZip = null;

    // SortableJS Initialization
    function initSortable() {
        sortableInstance = new Sortable(fileList, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            filter: '.remove-btn', // 削除ボタンではドラッグを開始しない
            preventOnFilter: false, // 削除ボタンのクリックイベントをブロックしない
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

        // Determine icon based on file type
        let iconClass = 'fa-file-pdf';
        if (file.type.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(file.name)) {
            iconClass = 'fa-file-image';
        }

        li.innerHTML = `
            <div class="file-info">
                <i class="fa-solid fa-grip-vertical drag-handle" title="ドラッグして並べ替え"></i>
                <i class="fa-solid ${iconClass} file-icon"></i>
                <div class="file-details">
                    <span class="file-name" title="${file.name}">${file.name}</span>
                    <span class="file-size">${formatFileSize(file.size)}</span>
                </div>
            </div>
            <button class="remove-btn" title="削除" onclick="removeFile('${id}')">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;

        fileList.appendChild(li);
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
        }
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
});
