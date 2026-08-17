        window.GoogleDriveAPI = {
            accessToken: sessionStorage.getItem('sagak_drive_token') || null,
            tokenExpiresAt: parseInt(sessionStorage.getItem('sagak_drive_token_expiry') || '0', 10),

            requestAccessToken(interactive) {
                return new Promise((resolve, reject) => {
                    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
                        reject(new Error('Google 인증 스크립트를 아직 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'));
                        return;
                    }
                    try {
                        const client = window.google.accounts.oauth2.initTokenClient({
                            client_id: window.GOOGLE_CLIENT_ID,
                            scope: window.GOOGLE_DRIVE_SCOPE,
                            callback: (resp) => {
                                if (!resp || resp.error) {
                                    reject(resp && resp.error ? new Error(resp.error) : new Error('로그인이 취소되었습니다.'));
                                    return;
                                }
                                this.accessToken = resp.access_token;
                                this.tokenExpiresAt = Date.now() + (parseInt(resp.expires_in || '3600', 10) * 1000) - 30000;
                                try {
                                    sessionStorage.setItem('sagak_drive_token', this.accessToken);
                                    sessionStorage.setItem('sagak_drive_token_expiry', this.tokenExpiresAt.toString());
                                } catch (e) {}
                                this.scheduleRefresh();
                                resolve(this.accessToken);
                            },
                            error_callback: (err) => {
                                reject(err instanceof Error ? err : new Error((err && err.type) || '로그인에 실패했습니다.'));
                            }
                        });
                        client.requestAccessToken(interactive ? { prompt: 'select_account' } : { prompt: 'none' });
                    } catch (e) {
                        reject(e);
                    }
                });
            },

            async ensureAccessToken() {
                if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken;
                // 메모리에 없거나 만료된 경우 대화형/비대화형 인증 요청
                try {
                    return await this.requestAccessToken(false);
                } catch {
                    return this.requestAccessToken(true);
                }
            },

            scheduleRefresh() {
                if (this._refreshTimer) clearTimeout(this._refreshTimer);
                const timeLeft = this.tokenExpiresAt - Date.now() - 120000;
                if (timeLeft > 0) {
                    this._refreshTimer = setTimeout(async () => {
                        try {
                            await this.requestAccessToken(false);
                        } catch {
                            await this.requestAccessToken(true);
                        }
                    }, timeLeft);
                }
            },

            revoke() {
                if (this._refreshTimer) clearTimeout(this._refreshTimer);
                const token = this.accessToken;
                this.accessToken = null;
                this.tokenExpiresAt = 0;
                try {
                    sessionStorage.removeItem('sagak_drive_token');
                    sessionStorage.removeItem('sagak_drive_token_expiry');
                } catch (e) {}
                if (token && window.google && window.google.accounts && window.google.accounts.oauth2) {
                    window.google.accounts.oauth2.revoke(token, () => {});
                }
            },

            async fetchProfile(token) {
                const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (!res.ok) throw new Error('사용자 정보를 가져오지 못했습니다.');
                return res.json();
            },

            async findFile(token, filename) {
                const q = encodeURIComponent(`name = '${filename.replace(/'/g, "\\'")}' and trashed = false`);
                const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime)`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (!res.ok) throw new Error('드라이브 조회에 실패했습니다.');
                const data = await res.json();
                return data.files || [];
            },

            async uploadJson(token, filename, jsonObj, existingFileId) {
                const metadata = { name: filename, mimeType: 'application/json' };
                const boundary = 'sagak_' + Date.now();
                const body =
                    `--${boundary}\r\n` +
                    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
                    JSON.stringify(metadata) + `\r\n` +
                    `--${boundary}\r\n` +
                    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
                    JSON.stringify(jsonObj) + `\r\n` +
                    `--${boundary}--`;

                const url = existingFileId
                    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
                    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
                const res = await fetch(url, {
                    method: existingFileId ? 'PATCH' : 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': `multipart/related; boundary=${boundary}`
                    },
                    body
                });
                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error('드라이브 저장에 실패했습니다: ' + errText);
                }
                return res.json();
            },

            async downloadFile(token, fileId) {
                const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (!res.ok) throw new Error('드라이브 파일을 불러오지 못했습니다.');
                return res.json();
            }
        };