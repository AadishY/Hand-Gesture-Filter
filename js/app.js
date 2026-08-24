/**
 * app.js - Main Application Coordinator for Gesture Filters
 */

import { FILTERS } from "./filters.js";
import { getPortalMetrics, portalWidth, portalMinFingertipDist, ClosingGestureDetector, renderPortal } from "./geometry.js";
import { HandTracker } from "./tracking.js";

const SETTINGS_KEY = "gesture_filters_settings_v4";

const DEFAULT_SETTINGS = {
    borderStyle: "glow",
    borderThickness: 2.5,
    showAnchors: true,
    elasticBending: true,
    closeRatio: 0.045,
    openRatio: 0.08,
    currentFilterIndex: 0
};

class ARFiltersApp {
    constructor() {
        this.video = document.getElementById("webcam-video");
        this.canvas = document.getElementById("render-canvas");
        this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });

        this.tracker = new HandTracker();
        this.gestureDetector = new ClosingGestureDetector(DEFAULT_SETTINGS.closeRatio, DEFAULT_SETTINGS.openRatio);

        // Load or initialize settings
        this.borderStyle = DEFAULT_SETTINGS.borderStyle;
        this.borderThickness = DEFAULT_SETTINGS.borderThickness;
        this.showAnchors = DEFAULT_SETTINGS.showAnchors;
        this.elasticBending = DEFAULT_SETTINGS.elasticBending;
        this.currentFilterIndex = DEFAULT_SETTINGS.currentFilterIndex;
        this.closeRatio = DEFAULT_SETTINGS.closeRatio;
        this.openRatio = DEFAULT_SETTINGS.openRatio;

        // Transient state
        this.showSkeleton = false;
        this.triggerRipple = 0;
        this.isUiHidden = false;
        this.isRunning = false;
        this.latestResults = null;
        this.stream = null;

        // Welcome screen DOM elements
        this.welcomeScreen = document.getElementById("welcome-screen");
        this.startBtn = document.getElementById("btn-start");
        this.ctaBtnText = document.getElementById("cta-btn-text");
        this.ctaSpinner = document.getElementById("cta-spinner");
        this.ctaStatusMsg = document.getElementById("cta-status-msg");
        this.cameraErrorBanner = document.getElementById("camera-error-banner");
        this.cameraErrorDesc = document.getElementById("camera-error-desc");
        this.btnRetryCamera = document.getElementById("btn-retry-camera");
        this.welcomeTrackingStatus = document.getElementById("welcome-tracking-status");

        // In-Experience UI elements
        this.uiLayer = document.getElementById("ui-layer");
        this.btnFilterMenu = document.getElementById("btn-filter-menu");
        this.filterDropdownMenu = document.getElementById("filter-dropdown-menu");
        this.filterOptionsList = document.getElementById("filter-options-list");
        this.btnSnap = document.getElementById("btn-snap");
        this.btnSkeleton = document.getElementById("btn-skeleton");
        this.btnGlow = document.getElementById("btn-glow");
        this.btnSettings = document.getElementById("btn-settings");
        this.btnInfoModal = document.getElementById("btn-info-modal");
        this.btnHideUi = document.getElementById("btn-hide-ui");
        this.btnRestoreUi = document.getElementById("btn-restore-ui");

        this.gestureHelpPanel = document.getElementById("gesture-help-panel");
        this.activeFilterBadge = document.getElementById("active-filter-badge");
        this.activeFilterName = document.getElementById("active-filter-name");
        this.trackingStatus = document.getElementById("tracking-status");
        this.trackingText = document.getElementById("tracking-text");
        this.proximityBar = document.getElementById("proximity-bar");
        this.gestureStateText = document.getElementById("gesture-state-text");

        this.screenFlash = document.getElementById("screen-flash");
        this.toastNotify = document.getElementById("toast-notify");

        // Settings Modal
        this.settingsModal = document.getElementById("settings-modal");
        this.btnCloseModal = document.getElementById("btn-close-modal");
        this.inputThickness = document.getElementById("input-thickness");
        this.valThickness = document.getElementById("val-thickness");
        this.btnStyleGlow = document.getElementById("btn-style-glow");
        this.btnStyleWhite = document.getElementById("btn-style-white");
        this.btnStyleNone = document.getElementById("btn-style-none");
        this.checkAnchors = document.getElementById("check-anchors");
        this.checkBending = document.getElementById("check-bending");
        this.inputCloseRatio = document.getElementById("input-close-ratio");
        this.inputOpenRatio = document.getElementById("input-open-ratio");
        this.valCloseRatio = document.getElementById("val-close-ratio");
        this.valOpenRatio = document.getElementById("val-open-ratio");
        this.cameraSelect = document.getElementById("camera-select");
        this.btnResetSettings = document.getElementById("btn-reset-settings");

        this.init();
    }

    async init() {
        this.loadSettings();
        this.buildFilterDropdownOptions();
        this.setupEventListeners();
        this.setupKeyboardShortcuts();

        this.startBtn.addEventListener("click", () => this.start());
        this.btnRetryCamera.addEventListener("click", () => this.start());

        window.addEventListener("resize", () => this.resizeCanvas());

        // Pre-initialize MediaPipe AI Vision models immediately on homepage load for instant startup
        this.preloadTracker();
    }

    async preloadTracker() {
        if (this.trackerInitPromise) return this.trackerInitPromise;
        this.trackerInitPromise = (async () => {
            try {
                if (this.welcomeTrackingStatus) {
                    this.welcomeTrackingStatus.textContent = "AI Loading...";
                }
                await this.tracker.init();
                this.tracker.onResults((results) => {
                    this.latestResults = results;
                });
                if (this.welcomeTrackingStatus) {
                    this.welcomeTrackingStatus.textContent = "AI Model Ready 🟢";
                    const dot = this.welcomeTrackingStatus.previousElementSibling;
                    if (dot) dot.style.backgroundColor = "#00ffcc";
                }
                if (this.ctaStatusMsg) {
                    this.ctaStatusMsg.textContent = "AI Vision Model ready. Click below to start camera.";
                }
            } catch (err) {
                console.warn("Tracker background pre-initialization warning:", err);
            }
        })();
        return this.trackerInitPromise;
    }

    loadSettings() {
        try {
            const saved = localStorage.getItem(SETTINGS_KEY);
            if (saved) {
                const cfg = JSON.parse(saved);
                if (cfg.borderStyle !== undefined) this.borderStyle = cfg.borderStyle;
                if (cfg.borderThickness !== undefined) this.borderThickness = parseFloat(cfg.borderThickness);
                if (cfg.showAnchors !== undefined) this.showAnchors = Boolean(cfg.showAnchors);
                if (cfg.elasticBending !== undefined) this.elasticBending = Boolean(cfg.elasticBending);
                if (cfg.closeRatio !== undefined) this.closeRatio = parseFloat(cfg.closeRatio);
                if (cfg.openRatio !== undefined) this.openRatio = parseFloat(cfg.openRatio);
                if (cfg.currentFilterIndex !== undefined) this.currentFilterIndex = parseInt(cfg.currentFilterIndex, 10);
            }
        } catch (e) {
            console.warn("Could not load saved settings:", e);
        }

        this.gestureDetector.setThresholds(this.closeRatio, this.openRatio);

        if (isNaN(this.currentFilterIndex) || this.currentFilterIndex < 0 || this.currentFilterIndex >= FILTERS.length) {
            this.currentFilterIndex = 0;
        }

        if (this.inputThickness) {
            this.inputThickness.value = this.borderThickness;
            if (this.valThickness) this.valThickness.textContent = `${this.borderThickness.toFixed(1)} px`;
        }
        if (this.checkAnchors) this.checkAnchors.checked = this.showAnchors;
        if (this.checkBending) this.checkBending.checked = this.elasticBending;
        if (this.inputCloseRatio) {
            this.inputCloseRatio.value = this.closeRatio;
            if (this.valCloseRatio) this.valCloseRatio.textContent = this.closeRatio.toFixed(2);
        }
        if (this.inputOpenRatio) {
            this.inputOpenRatio.value = this.openRatio;
            if (this.valOpenRatio) this.valOpenRatio.textContent = this.openRatio.toFixed(2);
        }

        this.setBorderStyle(this.borderStyle, false);
    }

    saveSettings() {
        try {
            const cfg = {
                borderStyle: this.borderStyle,
                borderThickness: this.borderThickness,
                showAnchors: this.showAnchors,
                elasticBending: this.elasticBending,
                closeRatio: this.closeRatio,
                openRatio: this.openRatio,
                currentFilterIndex: this.currentFilterIndex
            };
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg));
        } catch (e) {
            console.warn("Could not save settings:", e);
        }
    }

    resetSettings() {
        this.borderStyle = DEFAULT_SETTINGS.borderStyle;
        this.borderThickness = DEFAULT_SETTINGS.borderThickness;
        this.showAnchors = DEFAULT_SETTINGS.showAnchors;
        this.elasticBending = DEFAULT_SETTINGS.elasticBending;
        this.closeRatio = DEFAULT_SETTINGS.closeRatio;
        this.openRatio = DEFAULT_SETTINGS.openRatio;
        this.currentFilterIndex = 0;

        this.gestureDetector.setThresholds(this.closeRatio, this.openRatio);

        if (this.inputThickness) {
            this.inputThickness.value = this.borderThickness;
            if (this.valThickness) this.valThickness.textContent = `${this.borderThickness.toFixed(1)} px`;
        }
        if (this.checkAnchors) this.checkAnchors.checked = this.showAnchors;
        if (this.checkBending) this.checkBending.checked = this.elasticBending;
        if (this.inputCloseRatio) {
            this.inputCloseRatio.value = this.closeRatio;
            if (this.valCloseRatio) this.valCloseRatio.textContent = this.closeRatio.toFixed(2);
        }
        if (this.inputOpenRatio) {
            this.inputOpenRatio.value = this.openRatio;
            if (this.valOpenRatio) this.valOpenRatio.textContent = this.openRatio.toFixed(2);
        }

        this.setBorderStyle(this.borderStyle, false);
        this.saveSettings();
        this.showToast("Settings Reset to Defaults");
    }

    buildFilterDropdownOptions() {
        if (isNaN(this.currentFilterIndex) || this.currentFilterIndex < 0 || this.currentFilterIndex >= FILTERS.length) {
            this.currentFilterIndex = 0;
        }

        this.filterOptionsList.innerHTML = "";
        FILTERS.forEach((filter, idx) => {
            const item = document.createElement("div");
            item.className = `filter-option-item ${idx === this.currentFilterIndex ? "active" : ""}`;
            item.id = `filter-opt-${idx}`;
            item.innerHTML = `
                <span class="filter-option-badge">${filter.badge}</span>
                <span style="font-size: 1.1rem;">${filter.icon}</span>
                <span style="flex: 1;">${filter.name}</span>
            `;
            item.addEventListener("click", () => {
                this.setFilter(idx);
                this.closeFilterDropdown();
            });
            this.filterOptionsList.appendChild(item);
        });
        this.updateFilterDisplays();
    }

    updateFilterDisplays() {
        if (isNaN(this.currentFilterIndex) || this.currentFilterIndex < 0 || this.currentFilterIndex >= FILTERS.length) {
            this.currentFilterIndex = 0;
        }
        const active = FILTERS[this.currentFilterIndex] || FILTERS[0];
        if (active) {
            this.activeFilterBadge.textContent = active.badge;
            this.activeFilterName.textContent = `${active.icon} ${active.name}`;
        }

        document.querySelectorAll(".filter-option-item").forEach((item, idx) => {
            item.classList.toggle("active", idx === this.currentFilterIndex);
        });
    }

    toggleFilterDropdown() {
        this.filterDropdownMenu.classList.toggle("show");
    }

    closeFilterDropdown() {
        this.filterDropdownMenu.classList.remove("show");
    }

    setFilter(index) {
        this.currentFilterIndex = (index + FILTERS.length) % FILTERS.length;
        this.updateFilterDisplays();
        this.saveSettings();
        this.showToast(`Filter: ${FILTERS[this.currentFilterIndex].name}`);
    }

    nextFilter(fromGesture = false) {
        this.triggerRipple = 1.0;
        this.setFilter(this.currentFilterIndex + 1);

        if (fromGesture) {
            this.proximityBar.classList.add("triggered");
            setTimeout(() => {
                this.proximityBar.classList.remove("triggered");
            }, 300);
        }
    }

    prevFilter() {
        this.setFilter(this.currentFilterIndex - 1);
    }

    setBorderStyle(style, showToast = true) {
        this.borderStyle = style;

        document.querySelectorAll(".segment-btn").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.style === style);
        });

        const labelEl = document.getElementById("label-active-style");
        if (labelEl) {
            labelEl.textContent = style === "glow" ? "Sci-Fi Glow" : (style === "white" ? "Clean White" : "Borderless");
        }

        const rowThickness = document.getElementById("row-thickness");
        if (rowThickness) {
            rowThickness.style.opacity = style === "none" ? "0.45" : "1.0";
        }

        if (style === "none" && this.valThickness) {
            this.valThickness.textContent = "0.0 px (Off)";
        } else if (this.valThickness) {
            this.valThickness.textContent = `${this.borderThickness.toFixed(1)} px`;
        }

        if (this.btnGlow) {
            this.btnGlow.classList.toggle("active", style === "glow");
        }

        this.saveSettings();

        if (showToast) {
            if (style === "glow") {
                this.showToast("Portal Style: Sci-Fi Neon Glow");
            } else if (style === "white") {
                this.showToast("Portal Style: Clean White Border");
            } else {
                this.showToast("Portal Style: Borderless");
            }
        }
    }

    toggleUiVisibility() {
        this.isUiHidden = !this.isUiHidden;
        this.uiLayer.classList.toggle("hidden", this.isUiHidden);
        document.body.classList.toggle("ui-is-hidden", this.isUiHidden);
        this.closeFilterDropdown();

        if (this.isUiHidden) {
            this.showToast("UI Hidden — Press 'H' or tap Eye to restore");
        } else {
            this.showToast("UI Restored");
        }
    }

    toggleWelcomeScreen() {
        const isHidden = this.welcomeScreen.classList.contains("hidden");
        if (isHidden) {
            this.welcomeScreen.classList.remove("hidden");
            this.ctaBtnText.textContent = "RETURN TO EXPERIENCE";
            this.ctaStatusMsg.textContent = "Camera & tracking running";
        } else {
            this.welcomeScreen.classList.add("hidden");
        }
    }

    showToast(message) {
        if (!this.toastNotify) return;
        this.toastNotify.textContent = message;
        this.toastNotify.classList.add("show");
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            this.toastNotify.classList.remove("show");
        }, 2200);
    }

    async start() {
        if (this.isRunning) {
            this.welcomeScreen.classList.add("hidden");
            this.uiLayer.classList.remove("hidden");
            return;
        }

        try {
            this.cameraErrorBanner.classList.add("hidden");
            this.startBtn.disabled = true;
            this.ctaBtnText.textContent = "STARTING CAMERA...";
            this.ctaSpinner.classList.remove("hidden");
            this.ctaStatusMsg.textContent = "Opening webcam stream...";

            await this.preloadTracker();
            await this.startCamera();
            await this.populateCameras();

            this.welcomeScreen.classList.add("hidden");
            this.uiLayer.classList.remove("hidden");

            this.isRunning = true;
            this.startBtn.disabled = false;
            this.ctaSpinner.classList.add("hidden");
            this.ctaBtnText.textContent = "RETURN TO AR";

            this.runRenderLoop();
            this.runTrackingLoop();
            this.showToast("Portal Ready! Raise both hands");
        } catch (err) {
            console.error("Camera access / Initialization error:", err);
            this.startBtn.disabled = false;
            this.ctaSpinner.classList.add("hidden");
            this.ctaBtnText.textContent = "GRANT CAMERA ACCESS";
            this.ctaStatusMsg.textContent = "Camera access is required to run the AR portal.";

            this.cameraErrorBanner.classList.remove("hidden");
            this.welcomeTrackingStatus.textContent = "Camera Blocked";
            this.welcomeTrackingStatus.previousElementSibling.style.backgroundColor = "#ff4444";

            if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
                this.cameraErrorDesc.innerHTML = `
                    <strong>Camera permission was denied.</strong><br>
                    Please click the lock 🔒 or camera 📷 icon in your browser's address bar, set Camera to <em>"Allow"</em>, and click Retry below.
                `;
            } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
                this.cameraErrorDesc.innerHTML = `
                    <strong>No camera detected.</strong><br>
                    Please connect a webcam or enable your device camera, and click Retry below.
                `;
            } else {
                this.cameraErrorDesc.innerHTML = `
                    <strong>Unable to start camera:</strong> ${err.message || "Unknown error"}.<br>
                    Please ensure no other app is using the webcam and click Retry.
                `;
            }
        }
    }

    resizeCanvas() {
        if (this.video && this.video.videoWidth) {
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
        }
    }

    async startCamera(deviceId = null) {
        if (this.stream) {
            this.stream.getTracks().forEach((track) => track.stop());
        }

        const constraints = {
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                facingMode: "user"
            },
            audio: false
        };

        if (deviceId) {
            constraints.video.deviceId = { exact: deviceId };
            delete constraints.video.facingMode;
        }

        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.video.srcObject = this.stream;

        await new Promise((resolve, reject) => {
            this.video.onloadedmetadata = () => {
                this.video.play();
                this.resizeCanvas();
                resolve();
            };
            this.video.onerror = (e) => reject(e);
        });
    }

    async populateCameras() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter((d) => d.kind === "videoinput");
            this.cameraSelect.innerHTML = "";

            videoDevices.forEach((device, i) => {
                const opt = document.createElement("option");
                opt.value = device.deviceId;
                opt.textContent = device.label || `Camera ${i + 1}`;
                this.cameraSelect.appendChild(opt);
            });
        } catch (e) {
            console.warn("Could not enumerate video devices:", e);
        }
    }

    async runTrackingLoop() {
        while (this.isRunning) {
            if (this.video.readyState >= 2) {
                try {
                    await this.tracker.send(this.video);
                } catch (e) {
                    console.warn("Tracking loop error:", e);
                }
            }
            await new Promise((r) => requestAnimationFrame(r));
        }
    }

    runRenderLoop() {
        const render = () => {
            if (!this.isRunning) return;

            const w = this.canvas.width;
            const h = this.canvas.height;

            // 1. Render mirrored camera feed
            if (this.video.readyState >= 2) {
                this.ctx.drawImage(this.video, 0, 0, w, h);
            }

            // 2. Extract portal points (handles 2 hands, single hand, or grace period)
            const portalData = this.tracker.extractPortalPoints(this.latestResults, w, h);

            if (portalData && portalData.p1 && portalData.p2 && portalData.p3 && portalData.p4) {
                const { p1, p2, p3, p4, leftHand, rightHand, depth3D } = portalData;

                this.trackingStatus.className = "status-indicator active-portal";
                this.trackingText.textContent = depth3D && depth3D.closerHand !== "even"
                    ? `Portal 3D • ${depth3D.closerHand === "left" ? "Left Hand Closer" : "Right Hand Closer"} (${Math.round(depth3D.yawDeg)}°)`
                    : "Portal Active (3D)";

                // Calculate full portal metrics (hand distance, left/right pinch distances)
                const metrics = getPortalMetrics(p1, p2, p3, p4);
                const progress = this.gestureDetector.getProgress(metrics, w);
                this.proximityBar.style.width = `${Math.min(100, Math.max(0, Math.round(progress * 100)))}%`;

                const isTouching = metrics.topW < 0.08 * w && metrics.bottomW < 0.08 * w;

                if (this.gestureDetector.isClosed) {
                    this.gestureStateText.textContent = "SWITCHED";
                } else if (isTouching) {
                    this.gestureStateText.textContent = "TOUCHING 🤝";
                } else {
                    this.gestureStateText.textContent = progress > 0.50 ? "CLOSING..." : (depth3D ? `3D (${Math.round(depth3D.yawDeg)}°)` : "OPEN");
                }

                if (this.gestureDetector.updateFromMetrics(metrics, w)) {
                    this.nextFilter(true);
                }

                // Decay switch ripple burst
                if (this.triggerRipple > 0) {
                    this.triggerRipple = Math.max(0, this.triggerRipple - 0.08);
                }

                // 3. Render AR Portal with 3D perspective depth, volumetric shadow, thickness, glow, and elastic twisting
                renderPortal(
                    this.ctx,
                    p1, p2, p3, p4,
                    FILTERS[this.currentFilterIndex].fn,
                    {
                        borderThickness: this.borderThickness,
                        borderStyle: this.borderStyle,
                        showAnchors: this.showAnchors,
                        triggerRipple: this.triggerRipple,
                        elasticBending: this.elasticBending,
                        depth3D: depth3D
                    }
                );

                // Optional skeleton
                if (this.showSkeleton && leftHand && rightHand) {
                    this.tracker.drawHandSkeleton(this.ctx, leftHand, w, h, true);
                    this.tracker.drawHandSkeleton(this.ctx, rightHand, w, h, false);
                }
            } else if (portalData && portalData.singleHand) {
                // SINGLE HAND DETECTED
                const sh = portalData.singleHand;
                this.trackingStatus.className = "status-indicator active-tracking";
                this.trackingText.textContent = sh.isLeft ? "✋ Left Hand Ready • Raise Right Hand" : "✋ Right Hand Ready • Raise Left Hand";
                this.proximityBar.style.width = "0%";
                this.gestureStateText.textContent = "1 HAND";

                // Draw targeting aura and skeleton on single hand
                this.tracker.drawSingleHandAura(this.ctx, sh);
                if (this.showSkeleton) {
                    this.tracker.drawHandSkeleton(this.ctx, sh.hand, w, h, sh.isLeft);
                }
            } else {
                // SEARCHING FOR HANDS
                this.trackingStatus.className = "status-indicator";
                this.trackingText.textContent = "Searching Hands...";
                this.proximityBar.style.width = "0%";
                this.gestureStateText.textContent = "IDLE";
            }

            requestAnimationFrame(render);
        };

        requestAnimationFrame(render);
    }

    captureSnapshot() {
        this.screenFlash.classList.add("flash");
        setTimeout(() => this.screenFlash.classList.remove("flash"), 150);

        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = this.canvas.width;
        exportCanvas.height = this.canvas.height;
        const expCtx = exportCanvas.getContext("2d");

        expCtx.translate(exportCanvas.width, 0);
        expCtx.scale(-1, 1);
        expCtx.drawImage(this.canvas, 0, 0);

        const dataUrl = exportCanvas.toDataURL("image/png");
        const link = document.createElement("a");
        const dateStr = new Date().toISOString().replace(/[:.]/g, "-");
        link.download = `Gesture_Filters_${FILTERS[this.currentFilterIndex].id}_${dateStr}.png`;
        link.href = dataUrl;
        link.click();

        this.showToast("Snapshot Saved!");
    }

    setupEventListeners() {
        this.btnFilterMenu.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggleFilterDropdown();
        });

        document.addEventListener("click", (e) => {
            if (!this.filterDropdownMenu.contains(e.target) && e.target !== this.btnFilterMenu) {
                this.closeFilterDropdown();
            }
        });

        this.btnSnap.addEventListener("click", () => this.captureSnapshot());

        this.btnSkeleton.addEventListener("click", () => {
            this.showSkeleton = !this.showSkeleton;
            this.btnSkeleton.classList.toggle("active", this.showSkeleton);
            this.showToast(this.showSkeleton ? "Skeleton: ON" : "Skeleton: OFF");
        });

        this.btnGlow.addEventListener("click", () => {
            if (this.borderStyle === "glow") {
                this.setBorderStyle("white");
            } else if (this.borderStyle === "white") {
                this.setBorderStyle("none");
            } else {
                this.setBorderStyle("glow");
            }
        });

        this.btnInfoModal.addEventListener("click", () => this.toggleWelcomeScreen());
        this.btnHideUi.addEventListener("click", () => this.toggleUiVisibility());
        this.btnRestoreUi.addEventListener("click", () => this.toggleUiVisibility());

        this.btnSettings.addEventListener("click", () => {
            this.settingsModal.classList.add("show");
        });

        this.btnCloseModal.addEventListener("click", () => {
            this.settingsModal.classList.remove("show");
        });

        this.settingsModal.addEventListener("click", (e) => {
            if (e.target === this.settingsModal) {
                this.settingsModal.classList.remove("show");
            }
        });

        // Border style segmented buttons
        const stylePicker = document.getElementById("style-segmented-picker");
        if (stylePicker) {
            stylePicker.addEventListener("click", (e) => {
                const btn = e.target.closest(".segment-btn");
                if (btn && btn.dataset.style) {
                    this.setBorderStyle(btn.dataset.style);
                }
            });
        }

        [this.btnStyleGlow, this.btnStyleWhite, this.btnStyleNone].forEach((btn) => {
            if (btn) {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.setBorderStyle(btn.dataset.style);
                });
            }
        });

        // Border thickness slider
        if (this.inputThickness) {
            this.inputThickness.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                this.borderThickness = val;
                if (this.valThickness) {
                    this.valThickness.textContent = `${val.toFixed(1)} px`;
                }

                if (val === 0 && this.borderStyle !== "none") {
                    this.setBorderStyle("none", false);
                } else if (val > 0 && this.borderStyle === "none") {
                    this.setBorderStyle("glow", false);
                }
                this.saveSettings();
            });
        }

        // Anchor nodes checkbox
        if (this.checkAnchors) {
            this.checkAnchors.addEventListener("change", (e) => {
                this.showAnchors = e.target.checked;
                this.saveSettings();
                this.showToast(this.showAnchors ? "Anchor Dots: ON" : "Anchor Dots: OFF");
            });
        }

        // Elastic membrane bending checkbox
        if (this.checkBending) {
            this.checkBending.addEventListener("change", (e) => {
                this.elasticBending = e.target.checked;
                this.saveSettings();
                this.showToast(this.elasticBending ? "Elastic Bending: ON" : "Elastic Bending: OFF (Straight Quad)");
            });
        }

        // Threshold slider listeners
        this.inputCloseRatio.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            this.closeRatio = val;
            this.valCloseRatio.textContent = val.toFixed(2);
            this.gestureDetector.setThresholds(val, this.openRatio);
            this.saveSettings();
        });

        this.inputOpenRatio.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            this.openRatio = val;
            this.valOpenRatio.textContent = val.toFixed(2);
            this.gestureDetector.setThresholds(this.closeRatio, val);
            this.saveSettings();
        });

        // Camera switch
        this.cameraSelect.addEventListener("change", async (e) => {
            const deviceId = e.target.value;
            if (deviceId) {
                await this.startCamera(deviceId);
                this.showToast("Switched Camera");
            }
        });

        // Reset Settings button
        if (this.btnResetSettings) {
            this.btnResetSettings.addEventListener("click", () => this.resetSettings());
        }
    }

    setupKeyboardShortcuts() {
        window.addEventListener("keydown", (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;

            const key = e.key.toLowerCase();

            if (key >= "1" && key <= "9") {
                const num = parseInt(key, 10) - 1;
                if (num < FILTERS.length) {
                    this.setFilter(num);
                }
            } else if (key === "0" && FILTERS.length >= 10) {
                this.setFilter(9);
            } else if (key === "-" && FILTERS.length >= 11) {
                this.setFilter(10);
            } else if (key === "=" && FILTERS.length >= 12) {
                this.setFilter(11);
            } else if (key === "arrowright" || key === " ") {
                e.preventDefault();
                this.nextFilter();
            } else if (key === "arrowleft") {
                e.preventDefault();
                this.prevFilter();
            } else if (key === "h") {
                this.toggleUiVisibility();
            } else if (key === "i" || key === "?") {
                this.toggleWelcomeScreen();
            } else if (key === "s") {
                this.showSkeleton = !this.showSkeleton;
                this.btnSkeleton.classList.toggle("active", this.showSkeleton);
                this.showToast(this.showSkeleton ? "Skeleton: ON" : "Skeleton: OFF");
            } else if (key === "g") {
                if (this.borderStyle === "glow") {
                    this.setBorderStyle("white");
                } else if (this.borderStyle === "white") {
                    this.setBorderStyle("none");
                } else {
                    this.setBorderStyle("glow");
                }
            } else if (key === "c") {
                this.captureSnapshot();
            } else if (key === "escape") {
                this.closeFilterDropdown();
                this.settingsModal.classList.remove("show");
                if (!this.welcomeScreen.classList.contains("hidden") && this.isRunning) {
                    this.welcomeScreen.classList.add("hidden");
                }
            }
        });
    }
}

window.addEventListener("DOMContentLoaded", () => {
    window.app = new ARFiltersApp();
});
