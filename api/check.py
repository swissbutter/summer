# -*- coding: utf-8 -*-
import json
import os
import sys
import re
import requests
import time
import html as html_lib
from http.server import BaseHTTPRequestHandler

_session = requests.Session()
_passport_key = None
_last_key_time = 0

BASE_URL = "https://m.search.naver.com/p/csearch/ocontent/util/SpellerProxy"

def get_passport_key():
    global _passport_key, _last_key_time
    if _passport_key and (time.time() - _last_key_time < 1800):
        return _passport_key

    headers = {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "referer": "https://search.naver.com/",
    }
    try:
        r = _session.get("https://search.naver.com/search.naver?where=nexearch&query=맞춤법검사기", headers=headers, timeout=5)
        match = re.search(r"passportKey=([^&\"'\s]+)", r.text)
        if match:
            _passport_key = match.group(1)
            _last_key_time = time.time()
            return _passport_key
    except Exception as e:
        print(f"Error fetching passportKey: {e}", file=sys.stderr)
    return _passport_key or ""

TYPE_MAP = {
    "red_text": {"type": "spelling", "label": "맞춤법", "desc": "맞춤법이 올바르지 않습니다."},
    "green_text": {"type": "spacing", "label": "띄어쓰기", "desc": "띄어쓰기 오류입니다."},
    "violet_text": {"type": "ambiguous", "label": "표준어 의심", "desc": "표준어가 아니거나 문맥에 어색합니다."},
    "blue_text": {"type": "statistical", "label": "통계적 교정", "desc": "통계적으로 더 자연스러운 표현입니다."},
}

def clean_html_str(s):
    if not s:
        return ""
    s = s.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    s = html_lib.unescape(s)
    s = s.replace("\xa0", " ")
    return s

def parse_naver_response(origin_html, html):
    origin_parts = re.split(r"(<span class=['\"]result_underline['\"]>[\s\S]*?</span>)", origin_html, flags=re.IGNORECASE)
    origins = []
    for p in origin_parts:
        if not p:
            continue
        m = re.match(r"<span class=['\"]result_underline['\"]>([\s\S]*?)</span>", p, re.IGNORECASE)
        if m:
            origins.append({"text": clean_html_str(m.group(1)), "is_err": True})
        else:
            origins.append({"text": clean_html_str(p), "is_err": False})

    corr_pattern = re.compile(r"<em class=['\"]([^'\"]+)['\"]>([\s\S]*?)</em>", re.IGNORECASE)
    corrs = []
    for match in corr_pattern.finditer(html):
        cls, txt = match.groups()
        corrs.append({"text": clean_html_str(txt), "cls": cls})

    err_items = []
    orig_errs = [o for o in origins if o["is_err"]]

    for i in range(min(len(orig_errs), len(corrs))):
        o = orig_errs[i]
        c = corrs[i]
        tinfo = TYPE_MAP.get(c["cls"], {"type": "spelling", "label": "맞춤법", "desc": "수정이 필요합니다."})
        err_items.append({
            "id": i,
            "original": o["text"],
            "suggestion": c["text"],
            "type": tinfo["type"],
            "label": tinfo["label"],
            "desc": tinfo["desc"]
        })

    return origins, err_items

def split_text_clean(text, max_len=300):
    if len(text) <= max_len:
        return [text]
    chunks = []
    start = 0
    total_len = len(text)
    while start < total_len:
        if start + max_len >= total_len:
            chunks.append(text[start:])
            break
        end = start + max_len
        nl_pos = text.rfind('\n', start, end)
        if nl_pos > start + max_len // 3:
            split_pos = nl_pos + 1
        else:
            m = list(re.finditer(r'[.!?]\s+', text[start:end]))
            if m and (start + m[-1].end()) > (start + max_len // 3):
                split_pos = start + m[-1].end()
            else:
                sp_pos = text.rfind(' ', start, end)
                if sp_pos > start + max_len // 3:
                    split_pos = sp_pos + 1
                else:
                    split_pos = end
        chunks.append(text[start:split_pos])
        start = split_pos
    return chunks

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8')) if post_data else {}
            text = data.get("text", "")

            if not text or not text.strip():
                self.send_response(200)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "result": True,
                    "original": "",
                    "tokens": [],
                    "errors": []
                }, ensure_ascii=False).encode('utf-8'))
                return

            pkey = get_passport_key()
            headers = {
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "referer": "https://search.naver.com/",
            }

            chunks = split_text_clean(text, max_len=300)
            final_tokens = []
            all_errors = []
            cur_err_id = 0

            for chunk in chunks:
                payload = {
                    "passportKey": pkey,
                    "color_blindness": "0",
                    "q": chunk
                }

                res_json = None
                for attempt in range(2):
                    try:
                        r = _session.get(BASE_URL, params=payload, headers=headers, timeout=10)
                        res_json = json.loads(r.text)
                        if "error" in res_json.get("message", {}):
                            global _passport_key
                            _passport_key = None
                            pkey = get_passport_key()
                            payload["passportKey"] = pkey
                            continue
                        break
                    except Exception as retry_err:
                        print(f"[attempt {attempt+1}] Naver API error on chunk: {retry_err}", file=sys.stderr)
                        _passport_key = None
                        pkey = get_passport_key()
                        payload["passportKey"] = pkey
                        continue

                if not res_json or "error" in res_json.get("message", {}):
                    final_tokens.append({
                        "text": chunk,
                        "is_err": False,
                        "err_id": None,
                        "type": None
                    })
                    continue

                msg_result = res_json.get("message", {}).get("result", {})
                origin_html = msg_result.get("origin_html", chunk)
                html = msg_result.get("html", chunk)

                c_tokens, c_errors = parse_naver_response(origin_html, html)

                chunk_err_idx = 0
                for t in c_tokens:
                    if t["is_err"] and chunk_err_idx < len(c_errors):
                        err_obj = c_errors[chunk_err_idx]
                        global_err_id = cur_err_id
                        all_errors.append({
                            "id": global_err_id,
                            "original": err_obj["original"],
                            "suggestion": err_obj["suggestion"],
                            "type": err_obj["type"],
                            "label": err_obj["label"],
                            "desc": err_obj["desc"]
                        })
                        final_tokens.append({
                            "text": t["text"],
                            "is_err": True,
                            "err_id": global_err_id,
                            "type": err_obj["type"]
                        })
                        cur_err_id += 1
                        chunk_err_idx += 1
                    else:
                        final_tokens.append({
                            "text": t["text"],
                            "is_err": False,
                            "err_id": None,
                            "type": None
                        })

            self.send_response(200)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({
                "result": True,
                "original": text,
                "tokens": final_tokens,
                "errors": all_errors
            }, ensure_ascii=False).encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
