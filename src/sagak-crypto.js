window.SagakCrypto = {
            _PBKDF2_ITERATIONS: 100000,
            _SALT_BYTES: 16,
            _IV_BYTES: 12,

            async encrypt(plainText, password) {
                if (window.crypto && window.crypto.subtle) {
                    try {
                        const enc = new TextEncoder();
                        const salt = window.crypto.getRandomValues(new Uint8Array(this._SALT_BYTES));
                        const iv = window.crypto.getRandomValues(new Uint8Array(this._IV_BYTES));

                        const keyMaterial = await window.crypto.subtle.importKey(
                            "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
                        );
                        const key = await window.crypto.subtle.deriveKey(
                            { name: "PBKDF2", salt, iterations: this._PBKDF2_ITERATIONS, hash: "SHA-256" },
                            keyMaterial,
                            { name: "AES-GCM", length: 256 },
                            false, ["encrypt"]
                        );

                        const ciphertext = await window.crypto.subtle.encrypt(
                            { name: "AES-GCM", iv }, key, enc.encode(plainText)
                        );

                        const magic = new Uint8Array([83, 71, 75, 50]); // 'SGK2'
                        const combined = new Uint8Array(magic.length + salt.length + iv.length + ciphertext.byteLength);
                        combined.set(magic, 0);
                        combined.set(salt, magic.length);
                        combined.set(iv, magic.length + salt.length);
                        combined.set(new Uint8Array(ciphertext), magic.length + salt.length + iv.length);

                        let binary = '';
                        const len = combined.byteLength;
                        for (let i = 0; i < len; i++) {
                            binary += String.fromCharCode(combined[i]);
                        }
                        return btoa(binary);
                    } catch (e) {
                        console.warn('Web Crypto API encrypt failed, falling back to CryptoJS:', e);
                    }
                }

                const salt = CryptoJS.lib.WordArray.random(this._SALT_BYTES);
                const iv = CryptoJS.lib.WordArray.random(16);
                const key = CryptoJS.PBKDF2(password, salt, {
                    keySize: 256 / 32,
                    iterations: this._PBKDF2_ITERATIONS,
                    hasher: CryptoJS.algo.SHA256
                });
                const encrypted = CryptoJS.AES.encrypt(plainText, key, {
                    iv,
                    mode: CryptoJS.mode.CBC,
                    padding: CryptoJS.pad.Pkcs7
                });
                const combined = salt.clone().concat(iv).concat(encrypted.ciphertext);
                return CryptoJS.enc.Base64.stringify(combined);
            },

            async decrypt(payloadBase64, password) {
                if (!payloadBase64) return '';

                try {
                    const binaryStr = atob(payloadBase64.trim());
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let i = 0; i < binaryStr.length; i++) {
                        bytes[i] = binaryStr.charCodeAt(i);
                    }
                    if (bytes.length > 32 && bytes[0] === 83 && bytes[1] === 71 && bytes[2] === 75 && bytes[3] === 50) {
                        const salt = bytes.subarray(4, 20);
                        const iv = bytes.subarray(20, 32);
                        const ciphertext = bytes.subarray(32);

                        const enc = new TextEncoder();
                        const keyMaterial = await window.crypto.subtle.importKey(
                            "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
                        );
                        const key = await window.crypto.subtle.deriveKey(
                            { name: "PBKDF2", salt, iterations: this._PBKDF2_ITERATIONS, hash: "SHA-256" },
                            keyMaterial,
                            { name: "AES-GCM", length: 256 },
                            false, ["decrypt"]
                        );

                        const decryptedBuffer = await window.crypto.subtle.decrypt(
                            { name: "AES-GCM", iv }, key, ciphertext
                        );
                        return new TextDecoder().decode(decryptedBuffer);
                    }
                } catch (e) { /* Web Crypto decrypt failed or legacy format */ }

                try {
                    const combined = CryptoJS.enc.Base64.parse(payloadBase64);
                    const saltWords = 4;
                    const ivWords = 4;
                    const salt = CryptoJS.lib.WordArray.create(combined.words.slice(0, saltWords), 16);
                    const iv = CryptoJS.lib.WordArray.create(combined.words.slice(saltWords, saltWords + ivWords), 16);
                    const ciphertext = CryptoJS.lib.WordArray.create(
                        combined.words.slice(saltWords + ivWords),
                        combined.sigBytes - 32
                    );
                    const key = CryptoJS.PBKDF2(password, salt, {
                        keySize: 256 / 32,
                        iterations: this._PBKDF2_ITERATIONS,
                        hasher: CryptoJS.algo.SHA256
                    });
                    const decrypted = CryptoJS.AES.decrypt({ ciphertext }, key, {
                        iv,
                        mode: CryptoJS.mode.CBC,
                        padding: CryptoJS.pad.Pkcs7
                    });
                    return decrypted.toString(CryptoJS.enc.Utf8);
                } catch (e) {
                    return '';
                }
            },

            async decryptCompat(payload, password) {
                try {
                    const text = await this.decrypt(payload, password);
                    if (text) return text;
                } catch (e) { /* 구버전 방식 재시도 */ }

                try {
                    const bytes = CryptoJS.AES.decrypt(payload, password);
                    const result = bytes.toString(CryptoJS.enc.Utf8);
                    if (result) return result;
                } catch (e) {}

                return '';
            }
        };