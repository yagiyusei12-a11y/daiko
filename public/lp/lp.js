(function () {
  const form = document.getElementById("inquiry-form");
  const msgEl = document.getElementById("form-msg");
  const submitBtn = document.getElementById("submit-btn");

  function showMsg(text, ok) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.className = "lp-form-msg is-visible " + (ok ? "lp-form-msg--ok" : "lp-form-msg--err");
  }

  function hideMsg() {
    if (!msgEl) return;
    msgEl.className = "lp-form-msg";
    msgEl.textContent = "";
  }

  const menuBtn = document.getElementById("menu-btn");
  const mobileNav = document.getElementById("mobile-nav");

  function closeMobileNav() {
    if (!menuBtn || !mobileNav) return;
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.setAttribute("aria-label", "メニューを開く");
    mobileNav.hidden = true;
  }

  if (menuBtn && mobileNav) {
    menuBtn.addEventListener("click", function () {
      const open = menuBtn.getAttribute("aria-expanded") === "true";
      menuBtn.setAttribute("aria-expanded", open ? "false" : "true");
      menuBtn.setAttribute("aria-label", open ? "メニューを開く" : "メニューを閉じる");
      mobileNav.hidden = open;
    });
  }

  const faqList = document.getElementById("faq-list");
  if (faqList) {
    faqList.querySelectorAll(".lp-faq-item").forEach(function (item) {
      item.addEventListener("toggle", function () {
        if (!item.open) return;
        faqList.querySelectorAll(".lp-faq-item").forEach(function (other) {
          if (other !== item) other.open = false;
        });
      });
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function (e) {
      const id = link.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      closeMobileNav();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    hideMsg();

    const companyName = String(form.companyName?.value ?? "").trim();
    const contactName = String(form.contactName?.value ?? "").trim();
    const email = String(form.email?.value ?? "").trim();
    const phone = String(form.phone?.value ?? "").trim();
    const message = String(form.message?.value ?? "").trim();
    const website = String(form.website?.value ?? "").trim();
    const privacyAgreed = Boolean(form.privacyAgreed?.checked);

    if (!companyName || !contactName || !email || !message) {
      showMsg("必須項目を入力してください。", false);
      return;
    }
    if (!privacyAgreed) {
      showMsg("個人情報の取り扱いに同意してください。", false);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "送信中…";

    fetch("/api/v1/public/inquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName,
        contactName,
        email,
        phone: phone || undefined,
        message,
        website,
        privacyAgreed,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      })
      .then(function (r) {
        if (r.ok && r.data && r.data.ok) {
          form.reset();
          showMsg("お問い合わせを送信しました。担当よりご連絡いたします。", true);
          return;
        }
        if (r.status === 429) {
          showMsg("送信回数の上限に達しました。しばらくしてから再度お試しください。", false);
          return;
        }
        const err = (r.data && r.data.error) || "送信に失敗しました。時間をおいて再度お試しください。";
        showMsg(err, false);
      })
      .catch(function () {
        showMsg("通信エラーが発生しました。時間をおいて再度お試しください。", false);
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "送信する";
      });
  });
})();
