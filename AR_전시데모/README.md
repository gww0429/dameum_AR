# AR 전시 데모

QR로 접속 → 벽면 그래픽을 비추면 → 그 앞에 3D 모델이 나타나는 웹 AR입니다. 앱 설치는 필요 없습니다.
(MindAR + three.js, 라이브러리는 `lib/`에 내장되어 있어 인터넷 CDN을 쓰지 않습니다.)

## 파일
| 파일 | 역할 |
|---|---|
| `index.html` | 관람객이 여는 AR 페이지 |
| `config.js` | 그래픽·모델·크기·위치 설정 (교체할 때 이 파일만 수정) |
| `compiler.html` | 그래픽 이미지 → 인식 파일(`targets.mind`) 변환 도구 |
| `assets/` | 그래픽 이미지, 인식 파일, 3D 모델 |
| `serve.ps1` | PC 테스트용 로컬 서버 |

## PC에서 바로 시연 (웹캠)
1. 이 폴더에서 `powershell -ExecutionPolicy Bypass -File serve.ps1` 실행
2. 크롬에서 `http://localhost:8790` 접속 → AR 시작하기
3. `assets/target-01.png`를 휴대폰 화면에 띄우거나 출력해서 웹캠에 비춥니다.

처음 실행할 때는 인식 파일이 없어서 페이지가 그래픽을 직접 변환합니다(수십 초). 미리 만들어 두려면 `http://localhost:8790/compiler.html`에서 그래픽을 선택하고 변환한 뒤 「assets 폴더에 바로 저장」을 누르세요.

## 휴대폰으로 시연 (QR)
카메라는 **https 주소**에서만 켜집니다. 폴더 전체를 정적 호스팅에 올리면 됩니다.
- 가장 쉬운 방법: Netlify Drop(app.netlify.com/drop)에 폴더를 끌어다 놓으면 https 주소가 나옵니다.
- 그 주소로 QR을 만들어 붙입니다. 기본 카메라 앱으로 찍도록 안내하세요(카카오톡 스캐너는 카메라가 막힐 수 있음).

## 그래픽·모델 교체
1. 새 그래픽을 `compiler.html`에서 변환 → `assets/targets.mind` 덮어쓰기
2. 그래픽 이미지와 모델(`.glb`)을 `assets/`에 넣기
3. `config.js`의 `targets`에 `image`, `model` 경로 입력 (`model: null`이면 임시 모델)
4. 크기는 `scale`, 위치는 `position: [가로, 세로, 앞쪽]`으로 조정 (단위 = 그래픽 가로폭)

그래픽이 여러 장이면 `compiler.html`에서 여러 장을 한 번에 선택하고, `config.js`의 `targets`도 같은 순서로 적습니다.
