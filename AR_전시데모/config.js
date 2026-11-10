// ─────────────────────────────────────────────
// AR 전시 데모 설정 파일
// 그래픽·모델을 바꿀 때는 이 파일만 고치면 됩니다.
// ─────────────────────────────────────────────
window.AR_CONFIG = {
  // 첫 화면 문구
  title: "AR 전시 데모",
  subtitle: "벽면 그래픽을 카메라로 비추면 3D 모델이 나타납니다.",

  // compiler.html 에서 만든 인식 파일
  mindFile: "assets/targets.mind",

  // 동시에 인식할 최대 그래픽 수 (1 권장, 많을수록 무거워짐)
  maxTrack: 1,

  // 그래픽 목록 — compiler.html 에 넣은 순서와 같아야 합니다.
  //  image    : 스캔 안내 화면에 보여줄 그래픽 썸네일
  //  model    : GLB 파일 경로. null 이면 임시 모델이 나옵니다.
  //  scale    : 크기. 1 = 그래픽 가로폭과 같은 크기
  //  position : [가로, 세로, 앞쪽] 위치. 단위 = 그래픽 가로폭.
  //             앞쪽 값을 키우면 벽에서 더 떨어져 앞으로 나옵니다.
  //  rotation : [x, y, z] 회전(도). 모델을 Y축 위·정면(+Z) 기준으로 만들면 [0,0,0]
  //  spin     : true 면 천천히 회전
  targets: [
    {
      name: "그래픽 01",
      image: "assets/target-01.png",
      model: null,
      scale: 0.6,
      position: [0, 0.05, 0.35],
      rotation: [0, 0, 0],
      spin: true
    }
  ]
};
