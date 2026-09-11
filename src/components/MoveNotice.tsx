import { useEffect, useRef } from 'react'
import './MoveNotice.css'

export default function MoveNotice() {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    if (!node) return
    node.showModal()
    return () => node.close()
  }, [])

  return (
    <dialog ref={dialog} className="move-notice" aria-labelledby="move-notice-title" aria-describedby="move-notice-description">
      <span className="move-notice-label">CHATSHELF · 안내</span>
      <h2 id="move-notice-title">접속 링크가 변경되었습니다.</h2>
      <p id="move-notice-description">기존 챗서랍의 백업 기능으로 데이터를 저장한 뒤,<br />새 주소에서 복원해 주세요.</p>
      <p>양해 부탁드립니다. 감사합니다.</p>
      <div className="move-notice-links">
        <a href="https://chatshelf-2.stggang.workers.dev/" target="_blank" rel="noopener noreferrer">새 챗서랍으로 이동 <span aria-hidden="true">↗</span></a>
        <a href="https://kkangtong.xyz/posts/116704" target="_blank" rel="noopener noreferrer">깡싸 설명 글 <span aria-hidden="true">↗</span></a>
      </div>
      <p className="move-notice-timing">기존 챗서랍은 약 7일간 유지 후 비공개 예정입니다.</p>
      <form method="dialog"><button type="submit" autoFocus>닫고 백업하러 가기</button></form>
    </dialog>
  )
}
