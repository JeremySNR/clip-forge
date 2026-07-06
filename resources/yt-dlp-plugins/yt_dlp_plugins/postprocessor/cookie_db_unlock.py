"""
ClipForge yt-dlp plugin: read Chromium cookie databases even when the browser
has them open.

Chromium locks its SQLite cookie store while running, so yt-dlp's default
shutil.copy fails with "Could not copy Chrome cookie database". This plugin
patches _open_database_copy to fall back to SQLite's online backup API, which
can read a locked database in WAL mode.

On Windows, if the backup still fails, we also try the Restart Manager unlock
from seproDev/yt-dlp-ChromeCookieUnlock (MIT).
"""

from __future__ import annotations

import os
import sqlite3
import sys

import yt_dlp.cookies

_original_open = yt_dlp.cookies._open_database_copy


def _sqlite_backup_copy(database_path: str, tmpdir: str) -> str:
    dest = os.path.join(tmpdir, os.path.basename(database_path))
    uri = f'file:{database_path}?mode=ro'
    src = sqlite3.connect(uri, uri=True)
    try:
        dst = sqlite3.connect(dest)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    return dest


def _windows_unlock(cookies_path: str) -> None:
    # Adapted from seproDev/yt-dlp-ChromeCookieUnlock (MIT) / Charles Machalow.
    from ctypes import WINFUNCTYPE, byref, create_unicode_buffer, pointer, windll
    from ctypes.wintypes import DWORD, UINT, WCHAR

    ERROR_SUCCESS = 0
    ERROR_MORE_DATA = 234
    RmForceShutdown = 1

    @WINFUNCTYPE(None, UINT)
    def callback(percent_complete: UINT) -> None:
        pass

    rstrtmgr = windll.LoadLibrary('Rstrtmgr')
    session_handle = DWORD(0)
    session_flags = DWORD(0)
    session_key = (WCHAR * 256)()

    result = DWORD(
        rstrtmgr.RmStartSession(byref(session_handle), session_flags, session_key)
    ).value
    if result != ERROR_SUCCESS:
        raise RuntimeError(f'RmStartSession returned {result}')

    try:
        result = DWORD(
            rstrtmgr.RmRegisterResources(
                session_handle,
                1,
                byref(pointer(create_unicode_buffer(cookies_path))),
                0,
                None,
                0,
                None,
            )
        ).value
        if result != ERROR_SUCCESS:
            raise RuntimeError(f'RmRegisterResources returned {result}')

        proc_info_needed = DWORD(0)
        proc_info = DWORD(0)
        reboot_reasons = DWORD(0)
        result = DWORD(
            rstrtmgr.RmGetList(
                session_handle,
                byref(proc_info_needed),
                byref(proc_info),
                None,
                byref(reboot_reasons),
            )
        ).value
        if result not in (ERROR_SUCCESS, ERROR_MORE_DATA):
            raise RuntimeError(f'RmGetList returned {result}')

        if proc_info_needed.value:
            result = DWORD(
                rstrtmgr.RmShutdown(session_handle, RmForceShutdown, callback)
            ).value
            if result != ERROR_SUCCESS:
                raise RuntimeError(f'RmShutdown returned {result}')
    finally:
        result = DWORD(rstrtmgr.RmEndSession(session_handle)).value
        if result != ERROR_SUCCESS:
            raise RuntimeError(f'RmEndSession returned {result}')


def _open_database_copy_unlock(database_path: str, tmpdir: str) -> str:
    try:
        return _original_open(database_path, tmpdir)
    except (PermissionError, OSError) as err:
        print('Cookie database locked; trying SQLite backup…', file=sys.stderr)
        try:
            return _sqlite_backup_copy(database_path, tmpdir)
        except Exception:
            if sys.platform == 'win32':
                print('SQLite backup failed; trying Windows unlock…', file=sys.stderr)
                try:
                    _windows_unlock(database_path)
                    return _original_open(database_path, tmpdir)
                except Exception:
                    pass
            raise err


yt_dlp.cookies._open_database_copy = _open_database_copy_unlock
