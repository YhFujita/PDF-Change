document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileListSection = document.getElementById('file-list-section');
    const fileList = document.getElementById('file-list');
    const fileCount = document.getElementById('file-count');
    const actionSection = document.getElementById('action-section');
    const mergeBtn = document.getElementById('merge-btn');
    const clearBtn = document.getElementById('clear-btn');
    const loadingOverlay = document.getElementById('loading-overlay');

    // State
    const filesMap = new Map(); // ID -> File object
    let sortableInstance = null;

    // Initialize SortableJS
    initSortable();

    // Event Listeners
    setupDragAndDrop();
    setupFileInput();

    mergeBtn.addEventListener('click', mergePDFs);
    clearBtn.addEventListener('click', clearAllFiles);

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
        // Check for PDF by MIME type OR file extension for better cross-browser/OS compatibility
        const validFiles = Array.from(files).filter(file => {
            return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        });

        if (validFiles.length === 0 && files.length > 0) {
            alert('PDFファイルのみアップロード可能です。');
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

        li.innerHTML = `
            <div class="file-info">
                <i class="fa-solid fa-grip-vertical drag-handle" title="ドラッグして並べ替え"></i>
                <i class="fa-solid fa-file-pdf file-icon"></i>
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
        } else {
            if (fileListColumn) fileListColumn.classList.add('hidden');
            actionSection.classList.add('hidden');
        }
    }

    // PDF Merge Logic
    async function mergePDFs() {
        if (filesMap.size < 2) {
            if (!confirm('ファイルが1つしかありません。結合せずにそのままダウンロードしますか？（通常は2つ以上のファイルを結合します）')) {
                return;
            }
        }

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
                    const pdf = await PDFDocument.load(arrayBuffer);
                    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
                    copiedPages.forEach((page) => mergedPdf.addPage(page));
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

    function downloadPDF(bytes, fileName) {
        const blob = new Blob([bytes], { type: 'application/pdf' });
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
