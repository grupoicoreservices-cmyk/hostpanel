"""Testes de regressão para o bug de FTP absolute-path no _SFTPHandle.upload.

Bug reproduzido: `_SFTPHandle.upload("/backup/empresa/dom/user/2026-07/x.eml", b"...")`
usava `STOR /backup/...` (absolute) que muitos FTP servers com chroot rejeitam.

Fix: `upload` faz CWD para o parent path e chama `STOR <filename>` com nome
relativo — mesmo padrão do teste de conexão manual.

Este teste usa um FakeFTP inline para validar que:
1. mkdirs cria a hierarquia via `mkd`/`cwd`
2. upload chama `storbinary` com nome RELATIVO (não absoluto)
3. download/remove também usam nome relativo após cwd
"""
from __future__ import annotations
import pytest
from services.backup_service import _SFTPHandle


class FakeFTP:
    """Mock mínimo de ftplib.FTP que registra chamadas."""

    def __init__(self):
        self.dirs = {"/"}
        self.cwd_path = "/"
        self.stor_calls = []  # list[(cmd, filename, current_cwd_at_time_of_call)]
        self.retr_calls = []
        self.dele_calls = []

    def cwd(self, path):
        # Simula chroot rigoroso: raise se destino não existe
        if path == "/":
            self.cwd_path = "/"
            return
        target = f"{self.cwd_path.rstrip('/')}/{path}" if not path.startswith("/") else path
        target = target.replace("//", "/")
        if target not in self.dirs:
            raise Exception(f"550 No such directory: {target}")
        self.cwd_path = target

    def mkd(self, path):
        target = f"{self.cwd_path.rstrip('/')}/{path}" if not path.startswith("/") else path
        target = target.replace("//", "/")
        self.dirs.add(target)

    def storbinary(self, cmd, fp):
        # cmd = "STOR filename"
        _, filename = cmd.split(" ", 1)
        self.stor_calls.append((filename, self.cwd_path))

    def retrbinary(self, cmd, callback):
        _, filename = cmd.split(" ", 1)
        self.retr_calls.append((filename, self.cwd_path))
        callback(b"fake-content")

    def delete(self, filename):
        self.dele_calls.append((filename, self.cwd_path))

    def quit(self):
        pass


@pytest.fixture
def ftp_handle():
    """_SFTPHandle já entrou no protocolo FTP; injetamos o FakeFTP."""
    h = _SFTPHandle.__new__(_SFTPHandle)
    h.cfg = {"protocol": "ftp"}
    h.protocol = "ftp"
    h._transport = None
    h._sftp = None
    h._ftp = FakeFTP()
    return h


def test_upload_uses_relative_filename(ftp_handle):
    """`STOR` deve receber APENAS o filename, não o path absoluto."""
    path = "/backup/empresa/dom.com/user/2026-07/msg.eml"
    ftp_handle.upload(path, b"raw email content")
    assert len(ftp_handle._ftp.stor_calls) == 1
    filename, cwd_when_called = ftp_handle._ftp.stor_calls[0]
    assert filename == "msg.eml", f"esperava filename relativo, veio: {filename!r}"
    # CWD deve estar no diretório-pai — não em `/`
    assert cwd_when_called == "/backup/empresa/dom.com/user/2026-07"


def test_mkdirs_creates_hierarchy(ftp_handle):
    ftp_handle.mkdirs("/backup/empresa/dom.com/user/2026-07")
    dirs = ftp_handle._ftp.dirs
    assert "/backup" in dirs
    assert "/backup/empresa" in dirs
    assert "/backup/empresa/dom.com" in dirs
    assert "/backup/empresa/dom.com/user" in dirs
    assert "/backup/empresa/dom.com/user/2026-07" in dirs


def test_upload_creates_missing_parents(ftp_handle):
    """Upload num caminho novo deve criar toda a hierarquia."""
    path = "/backup/a/b/c/x.eml"
    ftp_handle.upload(path, b"x")
    assert "/backup/a/b/c" in ftp_handle._ftp.dirs
    filename, cwd = ftp_handle._ftp.stor_calls[0]
    assert filename == "x.eml"
    assert cwd == "/backup/a/b/c"


def test_download_uses_relative_filename(ftp_handle):
    # Pré-cria a hierarquia
    ftp_handle.mkdirs("/backup/a/b")
    content = ftp_handle.download("/backup/a/b/msg.eml")
    assert content == b"fake-content"
    filename, cwd = ftp_handle._ftp.retr_calls[0]
    assert filename == "msg.eml"
    assert cwd == "/backup/a/b"


def test_remove_uses_relative_filename(ftp_handle):
    ftp_handle.mkdirs("/backup/a/b")
    ftp_handle.remove("/backup/a/b/msg.eml")
    filename, cwd = ftp_handle._ftp.dele_calls[0]
    assert filename == "msg.eml"
    assert cwd == "/backup/a/b"
