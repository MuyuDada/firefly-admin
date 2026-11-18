// Firefly CMS 登录页交互：角色跟随鼠标、眨眼、输密码时回避、失败摇头
// 动画状态机参考 guohaolian/animatedlogin（原生实现，无依赖）
(() => {
	"use strict";

	const $id = (id) => document.getElementById(id);

	const S = {
		mouseX: 0,
		mouseY: 0,
		typing: false,
		lookingAtEachOther: false,
		purpleBlink: false,
		blackBlink: false,
		purplePeek: false,
		pwdFocused: false,
		loginError: false,
		showPassword: false,
		typingTimer: null,
		errorTimer: null,
		peekTimer: null,
	};

	let boundRoot = null;
	let blinkStarted = false;

	/* ---------- 几何计算 ---------- */

	function calcPosition(el) {
		const rect = el.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 3;
		const dx = S.mouseX - cx;
		const dy = S.mouseY - cy;
		return {
			faceX: Math.max(-15, Math.min(15, dx / 20)),
			faceY: Math.max(-10, Math.min(10, dy / 30)),
			bodySkew: Math.max(-6, Math.min(6, -dx / 120)),
		};
	}

	function calcPupilOffset(el, maxDist) {
		const rect = el.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		const dx = S.mouseX - cx;
		const dy = S.mouseY - cy;
		const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDist);
		const angle = Math.atan2(dy, dx);
		return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
	}

	/* ---------- 渲染 ---------- */

	function updateCharacters() {
		const purple = $id("char-purple");
		const black = $id("char-black");
		const orange = $id("char-orange");
		const yellow = $id("char-yellow");
		const pwd = $id("password");
		if (!purple || !black || !orange || !yellow || !pwd) return;

		const purplePos = calcPosition(purple);
		const blackPos = calcPosition(black);
		const orangePos = calcPosition(orange);
		const yellowPos = calcPosition(yellow);

		const pwdLen = pwd.value.length;
		const isShowingPwd = pwdLen > 0 && S.showPassword;
		const isLookingAway = S.pwdFocused && !S.showPassword;
		const blinking = S.purpleBlink || S.blackBlink;

		/* ---- 紫色 ---- */
		if (isShowingPwd) {
			purple.style.transform = "skewX(0deg)";
			purple.style.height = "370px";
		} else if (isLookingAway) {
			purple.style.transform = "skewX(-14deg) translateX(-20px)";
			purple.style.height = "410px";
		} else if (S.typing) {
			purple.style.transform = `skewX(${(purplePos.bodySkew || 0) - 12}deg) translateX(40px)`;
			purple.style.height = "410px";
		} else {
			purple.style.transform = `skewX(${purplePos.bodySkew}deg)`;
			purple.style.height = "370px";
		}

		const pEyes = $id("purple-eyes");
		const pEyeL = $id("purple-eye-l");
		const pEyeR = $id("purple-eye-r");
		const pPupilL = $id("purple-pupil-l");
		const pPupilR = $id("purple-pupil-r");

		pEyeL.style.height = S.purpleBlink ? "2px" : "18px";
		pEyeR.style.height = S.purpleBlink ? "2px" : "18px";

		if (S.loginError) {
			pEyes.style.left = "30px";
			pEyes.style.top = "55px";
			pPupilL.style.transform = "translate(-3px, 4px)";
			pPupilR.style.transform = "translate(-3px, 4px)";
		} else if (isLookingAway) {
			pEyes.style.left = "20px";
			pEyes.style.top = "25px";
			pPupilL.style.transform = "translate(-5px, -5px)";
			pPupilR.style.transform = "translate(-5px, -5px)";
		} else if (isShowingPwd) {
			pEyes.style.left = "20px";
			pEyes.style.top = "35px";
			const px = S.purplePeek ? 4 : -4;
			const py = S.purplePeek ? 5 : -4;
			pPupilL.style.transform = `translate(${px}px, ${py}px)`;
			pPupilR.style.transform = `translate(${px}px, ${py}px)`;
		} else if (S.lookingAtEachOther) {
			pEyes.style.left = "55px";
			pEyes.style.top = "65px";
			pPupilL.style.transform = "translate(3px, 4px)";
			pPupilR.style.transform = "translate(3px, 4px)";
		} else {
			pEyes.style.left = 45 + purplePos.faceX + "px";
			pEyes.style.top = 40 + purplePos.faceY + "px";
			const po = calcPupilOffset(pEyeL, 5);
			pPupilL.style.transform = `translate(${po.x}px, ${po.y}px)`;
			pPupilR.style.transform = `translate(${po.x}px, ${po.y}px)`;
		}

		/* ---- 黑色 ---- */
		if (isShowingPwd) {
			black.style.transform = "skewX(0deg)";
		} else if (isLookingAway) {
			black.style.transform = "skewX(12deg) translateX(-10px)";
		} else if (S.lookingAtEachOther) {
			black.style.transform = `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px)`;
		} else if (S.typing) {
			black.style.transform = `skewX(${(blackPos.bodySkew || 0) * 1.5}deg)`;
		} else {
			black.style.transform = `skewX(${blackPos.bodySkew}deg)`;
		}

		const bEyes = $id("black-eyes");
		const bEyeL = $id("black-eye-l");
		const bEyeR = $id("black-eye-r");
		const bPupilL = $id("black-pupil-l");
		const bPupilR = $id("black-pupil-r");

		bEyeL.style.height = S.blackBlink ? "2px" : "16px";
		bEyeR.style.height = S.blackBlink ? "2px" : "16px";

		if (S.loginError) {
			bEyes.style.left = "15px";
			bEyes.style.top = "40px";
			bPupilL.style.transform = "translate(-3px, 4px)";
			bPupilR.style.transform = "translate(-3px, 4px)";
		} else if (isLookingAway) {
			bEyes.style.left = "10px";
			bEyes.style.top = "20px";
			bPupilL.style.transform = "translate(-4px, -5px)";
			bPupilR.style.transform = "translate(-4px, -5px)";
		} else if (isShowingPwd) {
			bEyes.style.left = "10px";
			bEyes.style.top = "28px";
			bPupilL.style.transform = "translate(-4px, -4px)";
			bPupilR.style.transform = "translate(-4px, -4px)";
		} else if (S.lookingAtEachOther) {
			bEyes.style.left = "32px";
			bEyes.style.top = "12px";
			bPupilL.style.transform = "translate(0px, -4px)";
			bPupilR.style.transform = "translate(0px, -4px)";
		} else {
			bEyes.style.left = 26 + blackPos.faceX + "px";
			bEyes.style.top = 32 + blackPos.faceY + "px";
			const bo = calcPupilOffset(bEyeL, 4);
			bPupilL.style.transform = `translate(${bo.x}px, ${bo.y}px)`;
			bPupilR.style.transform = `translate(${bo.x}px, ${bo.y}px)`;
		}

		/* ---- 橙色 ---- */
		const oMouth = $id("orange-mouth");
		if (S.loginError) {
			oMouth.style.left = 80 + orangePos.faceX + "px";
			oMouth.style.top = "130px";
		}
		if (isShowingPwd) {
			orange.style.transform = "skewX(0deg)";
		} else {
			orange.style.transform = `skewX(${orangePos.bodySkew}deg)`;
		}

		const oEyes = $id("orange-eyes");
		const oPupilL = $id("orange-pupil-l");
		const oPupilR = $id("orange-pupil-r");

		if (S.loginError) {
			oEyes.style.left = "60px";
			oEyes.style.top = "95px";
			oPupilL.style.transform = "translate(-3px, 4px)";
			oPupilR.style.transform = "translate(-3px, 4px)";
		} else if (isLookingAway) {
			oEyes.style.left = "50px";
			oEyes.style.top = "75px";
			oPupilL.style.transform = "translate(-5px, -5px)";
			oPupilR.style.transform = "translate(-5px, -5px)";
		} else if (isShowingPwd) {
			oEyes.style.left = "50px";
			oEyes.style.top = "85px";
			oPupilL.style.transform = "translate(-5px, -4px)";
			oPupilR.style.transform = "translate(-5px, -4px)";
		} else {
			oEyes.style.left = 82 + orangePos.faceX + "px";
			oEyes.style.top = 90 + orangePos.faceY + "px";
			const oo = calcPupilOffset(oPupilL, 5);
			oPupilL.style.transform = `translate(${oo.x}px, ${oo.y}px)`;
			oPupilR.style.transform = `translate(${oo.x}px, ${oo.y}px)`;
		}

		/* ---- 黄色 ---- */
		if (isShowingPwd) {
			yellow.style.transform = "skewX(0deg)";
		} else {
			yellow.style.transform = `skewX(${yellowPos.bodySkew}deg)`;
		}

		const yEyes = $id("yellow-eyes");
		const yPupilL = $id("yellow-pupil-l");
		const yPupilR = $id("yellow-pupil-r");
		const yMouth = $id("yellow-mouth");

		if (S.loginError) {
			yEyes.style.left = "35px";
			yEyes.style.top = "45px";
			yPupilL.style.transform = "translate(-3px, 4px)";
			yPupilR.style.transform = "translate(-3px, 4px)";
			yMouth.style.left = "30px";
			yMouth.style.top = "92px";
			yMouth.style.transform = "rotate(-8deg)";
		} else if (isLookingAway) {
			yEyes.style.left = "20px";
			yEyes.style.top = "30px";
			yPupilL.style.transform = "translate(-5px, -5px)";
			yPupilR.style.transform = "translate(-5px, -5px)";
			yMouth.style.left = "15px";
			yMouth.style.top = "78px";
			yMouth.style.transform = "rotate(0deg)";
		} else if (isShowingPwd) {
			yEyes.style.left = "20px";
			yEyes.style.top = "35px";
			yPupilL.style.transform = "translate(-5px, -4px)";
			yPupilR.style.transform = "translate(-5px, -4px)";
			yMouth.style.left = "10px";
			yMouth.style.top = "88px";
			yMouth.style.transform = "rotate(0deg)";
		} else {
			yEyes.style.left = 52 + yellowPos.faceX + "px";
			yEyes.style.top = 40 + yellowPos.faceY + "px";
			const yo = calcPupilOffset(yPupilL, 5);
			yPupilL.style.transform = `translate(${yo.x}px, ${yo.y}px)`;
			yPupilR.style.transform = `translate(${yo.x}px, ${yo.y}px)`;
			yMouth.style.left = 40 + yellowPos.faceX + "px";
			yMouth.style.top = 88 + yellowPos.faceY + "px";
			yMouth.style.transform = "rotate(0deg)";
		}

		void blinking;
	}

	/* ---------- 眨眼 / 偷看 ---------- */

	function loopBlink(key, delayMin = 3000, delayMax = 7000) {
		setTimeout(() => {
			if (!document.body.contains($id("char-purple"))) {
				loopBlink(key, delayMin, delayMax);
				return;
			}
			S[key] = true;
			updateCharacters();
			setTimeout(() => {
				S[key] = false;
				updateCharacters();
				loopBlink(key, delayMin, delayMax);
			}, 150);
		}, Math.random() * delayMax + delayMin);
	}

	function startBlink() {
		if (blinkStarted) return;
		blinkStarted = true;
		loopBlink("purpleBlink", 3000, 4000);
		loopBlink("blackBlink", 3500, 5000);
	}

	function schedulePeek() {
		clearTimeout(S.peekTimer);
		const pwd = $id("password");
		if (!pwd || !pwd.value.length || !S.showPassword) return;
		S.peekTimer = setTimeout(() => {
			if (!$id("password") || !$id("password").value.length || !S.showPassword) return;
			S.purplePeek = true;
			updateCharacters();
			setTimeout(() => {
				S.purplePeek = false;
				updateCharacters();
				schedulePeek();
			}, 800);
		}, Math.random() * 3000 + 2000);
	}

	/* ---------- 错误动画 ---------- */

	const SHAKE_IDS = [
		"purple-eyes",
		"black-eyes",
		"orange-eyes",
		"yellow-eyes",
		"yellow-mouth",
		"orange-mouth",
	];

	function triggerLoginError() {
		if (S.errorTimer) {
			clearTimeout(S.errorTimer);
			S.errorTimer = null;
		}
		const els = SHAKE_IDS.map($id).filter(Boolean);
		els.forEach((el) => el.classList.remove("shake-head"));
		void document.body.offsetHeight;

		S.loginError = true;
		S.pwdFocused = false;
		updateCharacters();

		const mouth = $id("orange-mouth");
		if (mouth) mouth.classList.add("visible");

		setTimeout(() => els.forEach((el) => el.classList.add("shake-head")), 350);

		S.errorTimer = setTimeout(() => {
			S.loginError = false;
			S.errorTimer = null;
			if (mouth) mouth.classList.remove("visible");
			els.forEach((el) => el.classList.remove("shake-head"));
			updateCharacters();
		}, 2500);
	}

	// 供 Vue 调用：登录失败时让角色摇头 + 显示错误
	window.cmsLoginError = (msg) => {
		const err = $id("error-msg");
		const input = $id("password");
		const label = $id("password-label");
		if (err) {
			err.textContent = msg || "密码不正确，请重试";
			err.classList.add("show");
		}
		if (input) input.classList.add("error");
		if (label) label.classList.add("error-label");
		triggerLoginError();
	};

	function clearLoginError() {
		const err = $id("error-msg");
		const input = $id("password");
		const label = $id("password-label");
		if (err) err.classList.remove("show");
		if (input) input.classList.remove("error");
		if (label) label.classList.remove("error-label");
	}

	/* ---------- 绑定 ---------- */

	function bind(root) {
		startBlink();

		const pwd = root.querySelector("#password");
		const toggle = root.querySelector("#toggle-password");
		const eyeOn = root.querySelector("#eye-icon");
		const eyeOff = root.querySelector("#eye-off-icon");

		if (pwd) {
			pwd.addEventListener("focus", () => {
				S.pwdFocused = true;
				clearLoginError();
				updateCharacters();
			});
			pwd.addEventListener("blur", () => {
				S.pwdFocused = false;
				updateCharacters();
			});
			pwd.addEventListener("input", () => {
				if (pwd.value.length === 0) {
					S.showPassword = false;
					if (pwd.type !== "password") pwd.type = "password";
					if (eyeOn) eyeOn.style.display = "block";
					if (eyeOff) eyeOff.style.display = "none";
				}
				updateCharacters();
			});
		}

		if (toggle) {
			toggle.addEventListener("click", () => {
				S.showPassword = !S.showPassword;
				if (pwd) pwd.type = S.showPassword ? "text" : "password";
				if (eyeOn) eyeOn.style.display = S.showPassword ? "none" : "block";
				if (eyeOff) eyeOff.style.display = S.showPassword ? "block" : "none";
				updateCharacters();
				if (S.showPassword) schedulePeek();
			});
		}

		updateCharacters();
	}

	function sync() {
		const root = document.querySelector(".login-view");
		if (root && root !== boundRoot) {
			boundRoot = root;
			bind(root);
		} else if (!root) {
			boundRoot = null;
		}
	}

	document.addEventListener("mousemove", (e) => {
		S.mouseX = e.clientX;
		S.mouseY = e.clientY;
		if (!S.typing && !S.loginError) updateCharacters();
	});

	window.addEventListener("resize", () => updateCharacters());

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", sync);
	} else {
		sync();
	}

	const mo = new MutationObserver(sync);
	mo.observe(document.body, { childList: true, subtree: true });
})();
