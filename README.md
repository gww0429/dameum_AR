# dameum_AR v1

전시회용 웹 AR 서비스. 관람객은 `index.html`(모바일), 설정 담당은 `admin.html`(PC 1280px 이상)을 씁니다.
카메라는 HTTPS에서만 켜지므로 GitHub Pages에 올려서 씁니다. 외부 CDN 없이 `lib/`의 내장 라이브러리만 씁니다.

## 폴더
| 경로 | 내용 |
|---|---|
| `index.html` | 관람객 웹앱 (홈 · AR · 선물 상자 · 직원 수령) |
| `admin.html` | 설정 페이지 (홈 꾸미기 · 포스터 · 직원 코드·스탬프 투어 · 발행 설정) |
| `config.json` | 행사 설정 한 개 (저장소 1개 = 행사 1개) |
| `assets/` | 포스터·모델·사은품 이미지, `targets.mind`(인식 파일), `placeholder.glb`(임시 모델) |
| `lib/` | MindAR 1.2.5, three 0.160(+ 압축 해제 도구·형식 변환 로더), model-viewer 3.5.0 |
| `.nojekyll` | GitHub Pages가 파일을 가공하지 않게 하는 빈 파일 (꼭 함께 올립니다) |
| `serve.ps1` | PC 테스트용 로컬 서버 (저장소에 올리지 않아도 됩니다) |

## 처음 올리는 법 (한 번만)
현재 `gww0429/dameum_AR` 저장소 루트에는 `AR_전시데모/`(v0)와, 그 폴더로 넘겨주는 `index.html`(리다이렉트)이 있습니다.

1. 이 폴더 안의 내용 전부(`index.html`, `admin.html`, `config.json`, `.nojekyll`, `README.md`, `css/`, `js/`, `lib/`, `assets/`)를 저장소 **루트**에 올립니다.
   - 새 `index.html`이 기존 리다이렉트 파일을 대체합니다. `AR_전시데모/`는 그대로 두어도 되고 지워도 됩니다.
   - 웹에서 끌어다 올릴 때 `.nojekyll`이 빠지지 않았는지 확인합니다(윈도우 탐색기에서 숨김 파일로 보일 수 있습니다).
2. 저장소 Settings → Pages → Source를 `Deploy from a branch`, 브랜치 `main` / 폴더 `/ (root)`로 둡니다.
3. 1~3분 뒤 `https://gww0429.github.io/dameum_AR/` 에서 관람객 화면, `…/admin.html` 에서 설정 페이지가 열립니다.

## 이후: 설정 페이지로 발행
1. PC 브라우저로 `https://gww0429.github.io/dameum_AR/admin.html`을 엽니다.
2. 처음이면 「발행 설정」에서 접근 키(토큰), 저장소 `gww0429/dameum_AR`, 브랜치 `main`을 넣고 「연결 확인」을 누릅니다. 이 값은 그 PC 브라우저에만 저장됩니다.
3. 기존 행사를 고칠 때는 헤더의 「사이트에서 불러오기」, 새 행사는 ⋯ → 「새 프로젝트」(빈 상태로 시작, 이전 행사 파일은 남지 않음).
4. 홈 꾸미기 → 포스터 등록·편집(오른쪽 휴대폰 미리보기로 확인) → 직원 코드·스탬프 투어를 정합니다. 편집 내용은 그 PC 브라우저에 자동 저장됩니다.
5. 「GitHub에 바로 발행」을 누르면 필요할 때 인식 파일을 먼저 만들고(변환 중에는 탭을 옮기지 마세요), 바뀐 파일만 커밋 1개로 올립니다. 1~3분 뒤 폰으로 확인합니다.
   - 더 이상 쓰지 않는 `assets/posters|models|gifts` 파일은 같은 커밋에서 지워집니다.
   - 처음 배포본의 직원 코드는 데모용입니다. 실제 행사 전에 「직원 코드·스탬프 투어」에서 새로 정해 주세요(원문은 어디에도 저장되지 않고 해시만 저장됩니다).

## 접근 키(토큰) 발급
1. GitHub 로그인 → 오른쪽 위 프로필 → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Token name 아무 이름, Expiration은 행사 기간에 맞게.
3. Repository access: **Only select repositories** → `gww0429/dameum_AR`.
4. Permissions → Repository permissions → **Contents: Read and write** (Metadata: Read-only는 자동으로 붙습니다).
5. Generate token → 나온 값을 설정 페이지 「발행 설정」의 접근 키 칸에 붙여 넣습니다. 이 값은 다시 볼 수 없으니 필요하면 새로 발급합니다.
6. 다른 사람과 같이 쓰는 PC라면 작업 후 「발행 설정」 → 「키 지우기」를 누릅니다.

## PC에서 테스트
```
powershell -ExecutionPolicy Bypass -File serve.ps1
```
- `http://localhost:8791/` 관람객 화면 (localhost는 HTTPS가 아니어도 카메라가 켜집니다)
- `http://localhost:8791/admin.html` 설정 페이지
- 미리보기 모드(카메라 없이): `?preview=1`(1번 포스터 인식 후 화면), `?preview=home`, `?preview=box`, 뒤에 `&reset=1`을 붙이면 미리보기 선물 상자를 비웁니다. 미리보기 저장은 실제 선물 상자와 따로 저장됩니다.

## 알아 둘 점
- 아이폰 「내 공간에 놓기」는 GLB에서 자동 변환한 USDZ라 애니메이션 없이 정지 모델로 보입니다.
- 3D 모델 형식
  - 관람객 화면과 「내 공간에 놓기」는 GLB만 씁니다. Draco·KTX2(Basis)·Meshopt로 압축한 GLB도 읽습니다(해제 도구는 `lib/three/addons/libs/`에 들어 있어 외부에서 받지 않습니다).
  - 설정 페이지에는 GLB 말고도 glTF(.gltf + .bin·텍스처), FBX, OBJ(+ .mtl·텍스처), STL, DAE(Collada), 3DS, PLY를 올릴 수 있습니다. 올릴 때 브라우저에서 GLB로 바꿔 저장합니다(애니메이션 유지). 텍스처가 따로 있으면 모델 파일과 함께 여러 개를 선택하거나 zip 하나로 묶어 올립니다.
  - USDZ는 받지 않습니다(아이폰 전용 형식이라 웹에서 안정적으로 읽을 수 없습니다).
  - 크기 기준은 저장되는 GLB에 적용합니다. 15MB를 넘으면 경고, 50MB를 넘으면 올릴 수 없습니다.
- 3D 제작 업체에 요청할 때: **GLB(glTF 2.0 바이너리) 한 파일, 5MB 안팎**, 텍스처 2048px 이하를 권장합니다. 용량이 크면 Draco(메시)·KTX2(텍스처) 압축을 요청하세요. 다른 형식에서 바꾼 GLB는 재질이 단순해지거나 용량이 커질 수 있습니다.
- 선물 상자는 관람객 폰 브라우저에 저장됩니다. 브라우저를 바꾸거나 데이터를 지우면 사라집니다.
