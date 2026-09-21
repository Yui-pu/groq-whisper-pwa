(() => {
    'use strict';

    // === 状態管理 ===
    const state = {
        isRecording: false,
        isProcessing: false,
        mediaRecorder: null,
        audioChunks: [],
        timerInterval: null,
        recordingStartTime: 0,
        settings: {
            apiKey: '',
            model: 'whisper-large-v3-turbo',
            language: 'ja',
        },
        history: [],
    };

    // === DOM要素 ===
    const $ = (id) => document.getElementById(id);
    const btnMic = $('btnMic');
    const micIcon = $('micIcon');
    const stopIcon = $('stopIcon');
    const micRing = $('micRing');
    const micStatus = $('micStatus');
    const micTimer = $('micTimer');
    const resultArea = $('resultArea');
    const resultPlaceholder = $('resultPlaceholder');
    const resultContent = $('resultContent');
    const resultText = $('resultText');
    const btnCopy = $('btnCopy');
    const btnShare = $('btnShare');
    const btnSettings = $('btnSettings');
    const settingsModal = $('settingsModal');
    const btnCloseSettings = $('btnCloseSettings');
    const inputApiKey = $('inputApiKey');
    const selectModel = $('selectModel');
    const selectLang = $('selectLang');
    const btnSaveSettings = $('btnSaveSettings');
    const btnToggleKey = $('btnToggleKey');
    const historyList = $('historyList');
    const btnClearHistory = $('btnClearHistory');

    // === 初期化 ===
    function init() {
        loadSettings();
        loadHistory();
        renderHistory();
        checkServerKey();

        btnMic.addEventListener('click', toggleRecording);
        btnCopy.addEventListener('click', copyResult);
        btnShare.addEventListener('click', shareResult);
        btnSettings.addEventListener('click', openSettings);
        btnCloseSettings.addEventListener('click', closeSettings);
        btnSaveSettings.addEventListener('click', saveSettings);
        btnToggleKey.addEventListener('click', toggleKeyVisibility);
        btnClearHistory.addEventListener('click', clearHistory);
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) closeSettings();
        });

        // Web Share API が使えない場合は非表示
        if (!navigator.share) btnShare.classList.add('hidden');

        // APIキー未設定なら設定画面を促す
        if (!state.settings.apiKey) {
            setTimeout(() => {
                checkServerKey();
            }, 500);
        }
    }

    async function checkServerKey() {
        try {
            const resp = await fetch('/api/health');
            const data = await resp.json();
            if (!data.has_server_key && !state.settings.apiKey) {
                showToast('⚙️ 設定からGroq APIキーを入力してください');
            }
        } catch (e) {
            if (!state.settings.apiKey) {
                showToast('⚙️ 設定からGroq APIキーを入力してください');
            }
        }
    }

    // === 録音制御 ===
    async function toggleRecording() {
        if (state.isProcessing) return;

        if (state.isRecording) {
            stopRecording();
        } else {
            await startRecording();
        }
    }

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { sampleRate: 44100, channelCount: 1, echoCancellation: true, noiseSuppression: true }
            });

            // WebM (Chrome/Android) を優先
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/mp4';

            state.mediaRecorder = new MediaRecorder(stream, { mimeType });
            state.audioChunks = [];

            state.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) state.audioChunks.push(e.data);
            };

            state.mediaRecorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                processAudio();
            };

            state.mediaRecorder.start(250); // 250msごとにチャンク
            state.isRecording = true;
            state.recordingStartTime = Date.now();
            updateUI();
            startTimer();

            // バイブレーション
            if (navigator.vibrate) navigator.vibrate(50);
        } catch (err) {
            console.error('Microphone error:', err);
            showToast('❌ マイクへのアクセスが拒否されました');
        }
    }

    function stopRecording() {
        if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
            state.mediaRecorder.stop();
        }
        state.isRecording = false;
        state.isProcessing = true;
        stopTimer();
        updateUI();

        if (navigator.vibrate) navigator.vibrate([30, 30, 30]);
    }

    // === 音声処理・API送信 ===
    async function processAudio() {
        const blob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType });

        if (blob.size < 1000) {
            state.isProcessing = false;
            updateUI();
            showToast('⚠️ 録音が短すぎます');
            return;
        }

        const ext = state.mediaRecorder.mimeType.includes('webm') ? 'webm' : 'm4a';

        try {
            let resp;
            if (state.settings.apiKey) {
                // APIキーが設定されている場合: Groq公式APIに直接リクエスト (最速・サーバーレス対応)
                const groqData = new FormData();
                groqData.append('file', blob, `audio.${ext}`);
                groqData.append('model', state.settings.model || 'whisper-large-v3-turbo');
                if (state.settings.language && state.settings.language !== 'auto') {
                    groqData.append('language', state.settings.language);
                }

                resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${state.settings.apiKey.trim()}`,
                    },
                    body: groqData,
                });
            } else {
                // APIキー未設定の場合: ローカルサーバーがあれば中継、なければ設定を促す
                try {
                    const health = await fetch('./api/health');
                    if (health.ok) {
                        const formData = new FormData();
                        formData.append('file', blob, `audio.${ext}`);
                        formData.append('model', state.settings.model);
                        formData.append('language', state.settings.language);
                        resp = await fetch('./api/transcribe', { method: 'POST', body: formData });
                    } else {
                        throw new Error('No local server');
                    }
                } catch (_) {
                    showToast('⚙️ 右上の設定からGroq APIキーを入力してください');
                    openSettings();
                    return;
                }
            }

            if (!resp.ok) {
                let errMsg = 'APIエラーが発生しました';
                try {
                    const errData = await resp.json();
                    errMsg = errData.error?.message || errData.detail || `エラー (${resp.status})`;
                } catch (_) {
                    errMsg = `HTTPエラー (${resp.status}): 通信に失敗しました`;
                }
                throw new Error(errMsg);
            }

            const data = await resp.json();
            const text = (data.text || '').trim();
            if (text) {
                showResult(text);
                addToHistory(text);
            } else {
                showToast('⚠️ 音声を認識できませんでした');
            }
        } catch (err) {
            console.error('Transcription error:', err);
            showToast(`❌ ${err.message}`);
        } finally {
            state.isProcessing = false;
            updateUI();
        }
    }

    // === UI更新 ===
    function updateUI() {
        // マイクボタン
        btnMic.classList.toggle('recording', state.isRecording);
        btnMic.classList.toggle('processing', state.isProcessing);
        micRing.classList.toggle('recording', state.isRecording);
        micIcon.classList.toggle('hidden', state.isRecording || state.isProcessing);
        stopIcon.classList.toggle('hidden', !state.isRecording);

        // ステータス
        micStatus.classList.remove('recording', 'processing', 'done');
        if (state.isRecording) {
            micStatus.textContent = 'タップで送信';
            micStatus.classList.add('recording');
            micTimer.classList.remove('hidden');
        } else if (state.isProcessing) {
            micStatus.textContent = '⚡ Groq で変換中...';
            micStatus.classList.add('processing');
            micTimer.classList.add('hidden');
        } else {
            micStatus.textContent = 'タップして録音';
            micTimer.classList.add('hidden');
        }
    }

    // === タイマー ===
    function startTimer() {
        updateTimerDisplay();
        state.timerInterval = setInterval(updateTimerDisplay, 100);
    }

    function stopTimer() {
        clearInterval(state.timerInterval);
    }

    function updateTimerDisplay() {
        const elapsed = Math.floor((Date.now() - state.recordingStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        micTimer.textContent = `${mins}:${secs}`;
    }

    // === 結果表示 ===
    function showResult(text) {
        resultText.textContent = text;
        resultPlaceholder.classList.add('hidden');
        resultContent.classList.remove('hidden');
        resultArea.classList.add('has-result');

        micStatus.textContent = '✅ 完了';
        micStatus.classList.add('done');
    }

    // === コピー ===
    async function copyResult() {
        const text = resultText.textContent;
        if (!text) return;

        try {
            await navigator.clipboard.writeText(text);
            btnCopy.classList.add('copied');
            btnCopy.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                コピー済み`;
            if (navigator.vibrate) navigator.vibrate(30);

            setTimeout(() => {
                btnCopy.classList.remove('copied');
                btnCopy.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    コピー`;
            }, 2000);
        } catch (err) {
            showToast('❌ コピーに失敗しました');
        }
    }

    // === 共有 ===
    async function shareResult() {
        const text = resultText.textContent;
        if (!text || !navigator.share) return;

        try {
            await navigator.share({ text });
        } catch (e) { /* ユーザーがキャンセルした場合 */ }
    }

    // === 設定 ===
    function openSettings() {
        inputApiKey.value = state.settings.apiKey;
        selectModel.value = state.settings.model;
        selectLang.value = state.settings.language;
        settingsModal.classList.remove('hidden');
    }

    function closeSettings() {
        settingsModal.classList.add('hidden');
    }

    function saveSettings() {
        state.settings.apiKey = inputApiKey.value.trim();
        state.settings.model = selectModel.value;
        state.settings.language = selectLang.value;
        localStorage.setItem('groq_whisper_settings', JSON.stringify(state.settings));
        closeSettings();
        showToast('✅ 設定を保存しました');
    }

    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem('groq_whisper_settings'));
            if (saved) Object.assign(state.settings, saved);
        } catch (e) { /* ignore */ }
    }

    function toggleKeyVisibility() {
        inputApiKey.type = inputApiKey.type === 'password' ? 'text' : 'password';
    }

    // === 履歴 ===
    function addToHistory(text) {
        state.history.unshift({
            text,
            timestamp: new Date().toISOString(),
        });
        if (state.history.length > 50) state.history.pop();
        localStorage.setItem('groq_whisper_history', JSON.stringify(state.history));
        renderHistory();
    }

    function loadHistory() {
        try {
            state.history = JSON.parse(localStorage.getItem('groq_whisper_history')) || [];
        } catch (e) {
            state.history = [];
        }
    }

    function clearHistory() {
        state.history = [];
        localStorage.removeItem('groq_whisper_history');
        renderHistory();
        showToast('履歴を削除しました');
    }

    function renderHistory() {
        if (state.history.length === 0) {
            historyList.innerHTML = '<p class="history-empty">まだ履歴がありません</p>';
            return;
        }

        historyList.innerHTML = state.history.map((item, i) => {
            const d = new Date(item.timestamp);
            const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
            return `
                <div class="history-item" data-index="${i}">
                    <div class="history-item-text">${escapeHtml(item.text)}</div>
                    <div class="history-item-meta">${time}</div>
                </div>`;
        }).join('');

        historyList.querySelectorAll('.history-item').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.index);
                const text = state.history[idx].text;
                navigator.clipboard.writeText(text).then(() => {
                    showToast('📋 クリップボードにコピーしました');
                    if (navigator.vibrate) navigator.vibrate(30);
                });
            });
        });
    }

    // === トースト通知 ===
    function showToast(message) {
        let toast = document.querySelector('.toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.remove('show');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.add('show');
            });
        });
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // === Service Worker登録 ===
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // === 起動 ===
    init();
})();
