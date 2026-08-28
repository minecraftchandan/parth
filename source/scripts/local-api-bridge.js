(function () {
  const remoteApi = "https://ourmoments.live/wp-json/om/v1";
  const apiBase = "/api";
  const originalFetch = window.fetch.bind(window);
  let pendingOtp;
  let verifiedOtp;
  let allowOriginalButtonClick = false;

  function askForOtp() {
    if (pendingOtp) return pendingOtp;
    pendingOtp = originalFetch(`${apiBase}/request-otp`, { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not send the OTP.");
        return response.json();
      })
      .then(({ challengeId }) => new Promise((resolve) => {
        const modal = document.createElement("div");
        modal.id = "local-otp-modal";
        modal.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);padding:20px";
        modal.innerHTML = `
          <form style="box-sizing:border-box;max-width:380px;width:100%;background:#fff;border-radius:20px;padding:28px;text-align:center;font-family:Arial,sans-serif;box-shadow:0 20px 60px #0006">
            <h2 style="margin:0 0 10px;color:#222">Enter your OTP</h2>
            <p style="margin:0 0 20px;color:#555">A new 4-digit code was sent to Discord.</p>
            <input name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4}" maxlength="4" required
              style="display:block;margin:auto;font-size:30px;text-align:center;width:170px;padding:10px;border:2px solid #ec1c64;border-radius:10px;letter-spacing:8px">
            <button type="submit" style="display:block;margin:20px auto 0;padding:12px 24px;border:0;border-radius:10px;background:#ec1c64;color:#fff;font-size:16px;cursor:pointer">Create my link</button>
            <div style="margin-top:12px;font-size:13px;color:#777">This code expires in 10 minutes.</div>
          </form>`;
        document.body.appendChild(modal);
        const input = modal.querySelector("input");
        input.focus();
        modal.querySelector("form").addEventListener("submit", (event) => {
          event.preventDefault();
          const otp = new FormData(event.currentTarget).get("otp");
          modal.remove();
          resolve({ challengeId, otp });
        });
      })).finally(() => {
        pendingOtp = null;
      });
  }

  function addOtpToRequest(body, request) {
    if (!verifiedOtp) return false;
    if (body instanceof FormData) {
      body.append("otpChallengeId", verifiedOtp.challengeId);
      body.append("otp", verifiedOtp.otp);
    } else {
      request.headers = new Headers(request.headers || {});
      request.headers.set("X-OTP-Challenge", verifiedOtp.challengeId);
      request.headers.set("X-OTP", verifiedOtp.otp);
    }
    verifiedOtp = null;
    return true;
  }

  function showGeneratedLink(payload) {
    const link = payload.link || payload.url ||
      (payload.code && `${window.location.origin}/s/${payload.code}`);
    if (!link || document.querySelector("#local-link-modal")) return;

    const modal = document.createElement("div");
    modal.id = "local-link-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);padding:20px";
    modal.innerHTML = `
      <div style="box-sizing:border-box;max-width:480px;width:100%;background:#fff;border-radius:20px;padding:28px;text-align:center;font-family:Arial,sans-serif;box-shadow:0 20px 60px #0006">
        <h2 style="margin:0 0 10px;color:#222">Your private link is ready 🎉</h2>
        <p style="margin:0 0 16px;color:#555">Send this link to the birthday star.</p>
        <input readonly value="${link.replace(/"/g, "&quot;")}" style="box-sizing:border-box;width:100%;padding:12px;border:2px solid #ec1c64;border-radius:10px;font-size:14px">
        <button type="button" style="margin-top:16px;padding:12px 24px;border:0;border-radius:10px;background:#ec1c64;color:#fff;font-size:16px;cursor:pointer">Copy link</button>
        <button type="button" data-close style="margin-left:8px;padding:12px 24px;border:0;border-radius:10px;background:#eee;color:#333;font-size:16px;cursor:pointer">Close</button>
      </div>`;
    modal.querySelector("button").addEventListener("click", () => navigator.clipboard.writeText(link));
    modal.querySelector("[data-close]").addEventListener("click", () => modal.remove());
    document.body.appendChild(modal);
  }

  window.Razorpay = function (options) {
    this.open = function () {
      if (typeof options.handler === "function") {
        options.handler({ razorpay_payment_id: "otp-payment-bypass" });
      }
    };
  };
  window.Razorpay.isLocalOtpFlow = true;

  const paymentTextObserver = new MutationObserver(() => {
    document.querySelectorAll("body *").forEach((element) => {
      if (element.children.length === 0 && /payment|reload|gateway/i.test(element.textContent || "")) {
        element.textContent = "Enter the OTP sent to Discord to create your private link.";
      }
    });
  });
  paymentTextObserver.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("#om-bday-pay-btn");
    if (!button || allowOriginalButtonClick) {
      allowOriginalButtonClick = false;
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    askForOtp()
      .then((auth) => {
        verifiedOtp = auth;
        allowOriginalButtonClick = true;
        button.click();
      })
      .catch((error) => alert(error.message));
  }, true);

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, inputUrl, ...rest) {
    const requestUrl = String(inputUrl);
    if (requestUrl.startsWith(remoteApi)) {
      inputUrl = apiBase + requestUrl.slice(remoteApi.length);
    }
    this._localApiPath = new URL(inputUrl, window.location.origin).pathname;
    return originalOpen.call(this, method, inputUrl, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this._localApiPath === "/api/create") {
      const request = {};
      if (!addOtpToRequest(body, request)) {
        this.abort();
        return;
      }
      if (request.headers) {
        this.setRequestHeader("X-OTP-Challenge", request.headers.get("X-OTP-Challenge"));
        this.setRequestHeader("X-OTP", request.headers.get("X-OTP"));
      }
      this.addEventListener("load", () => {
        if (this.status >= 200 && this.status < 300) {
          try { showGeneratedLink(JSON.parse(this.responseText)); } catch { /* Existing UI handles malformed responses. */ }
        }
      }, { once: true });
      originalSend.call(this, body);
      return;
    }
    return originalSend.call(this, body);
  };

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input.url;
    const parsedUrl = new URL(url, window.location.origin);
    if (!url.startsWith(remoteApi) && parsedUrl.pathname !== "/api/create") {
      return originalFetch(input, init);
    }

    const localUrl = url.startsWith(remoteApi)
      ? apiBase + url.slice(remoteApi.length)
      : parsedUrl.pathname + parsedUrl.search;
    const localPath = new URL(localUrl, window.location.origin).pathname;
    if (
      localPath === "/api/create-order" ||
      localPath === "/api/order-status" ||
      localPath === "/api/cf-verify"
    ) {
      return Promise.resolve(new Response(JSON.stringify({
        status: "success",
        order_id: "otp-flow",
        payment_status: "SUCCESS",
        verified: true,
        amount: 0,
        currency: "INR",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (localPath === "/api/create") {
      const request = { ...(init || {}) };
      if (!init && input instanceof Request) {
        request.method = input.method;
        request.headers = input.headers;
        if (input.method !== "GET" && input.method !== "HEAD") {
          return input.clone().formData().then((body) => {
            request.body = body;
            if (!addOtpToRequest(request.body, request)) {
              throw new Error("The link request did not include the birthday data.");
            }
            return originalFetch(localUrl, request);
          }).then((response) => {
            if (!response.ok) throw new Error("The link could not be created.");
            return response.clone().json().then((payload) => {
              showGeneratedLink(payload);
              return response;
            });
          }).catch((error) => {
            alert(error.message);
            throw error;
          });
        }
      }
      if (!addOtpToRequest(request.body, request)) {
        return Promise.reject(new Error("The link request did not include the birthday data."));
      }
      return originalFetch(localUrl, request)
        .then((response) => {
          if (!response.ok) {
            return response.clone().json().then((error) => {
              throw new Error(error.error || "The link could not be created.");
            });
          }
          return response.clone().json().then((payload) => {
            showGeneratedLink(payload);
            return response;
          });
        })
        .catch((error) => {
          alert(error.message);
          throw error;
        });
    }
    return originalFetch(localUrl, init);
  };
})();
