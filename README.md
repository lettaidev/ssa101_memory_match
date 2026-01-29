# Memory Match - English Learning Game 🎮

Một game học tiếng Anh kiểu lật thẻ (memory match), được xây dựng với Node.js, Express, Socket.IO và SQLite.

## 📋 Tính năng

- **Lật thẻ ghép cặp**: Người chơi lật thẻ để ghép cặp từ tiếng Anh với nghĩa tiếng Việt
- **Realtime multiplayer**: Hỗ trợ nhiều team chơi cùng lúc với Socket.IO
- **Bảng xếp hạng**: Xem điểm số của tất cả các team trong thời gian thực
- **Admin dashboard**: Quản lý từ vựng, cấu hình game, bắt đầu/kết thúc trận đấu
- **Database SQLite**: Lưu trữ dữ liệu với better-sqlite3

## 🛠️ Công nghệ sử dụng

- **Backend**: Node.js, Express 5, TypeScript
- **Realtime**: Socket.IO
- **Database**: SQLite (better-sqlite3)
- **Frontend**: HTML, Tailwind CSS, Vanilla JavaScript

## 📁 Cấu trúc dự án

```
├── src/
│   ├── server.ts      # Express server + Socket.IO
│   └── database.ts    # SQLite database setup
├── public/
│   ├── index.html     # Giao diện game chính
│   ├── scoreboard.html # Bảng xếp hạng
│   └── ta_admin.html  # Admin dashboard
├── package.json
└── tsconfig.json
```

## 🚀 Cài đặt

### Yêu cầu
- Node.js >= 18
- npm hoặc yarn

### Các bước

1. **Clone repository**
   ```bash
   git clone <repo-url>
   cd new
   ```

2. **Cài đặt dependencies**
   ```bash
   npm install
   ```

3. **Chạy development server**
   ```bash
   npm run dev
   ```

4. **Build production**
   ```bash
   npm run build
   npm start
   ```

## 📖 Sử dụng

### Người chơi
1. Truy cập `http://localhost:3000`
2. Nhập tên team và tham gia game
3. Đợi admin bắt đầu game
4. Lật thẻ để ghép cặp từ tiếng Anh - tiếng Việt

### Admin
1. Truy cập `http://localhost:3000/ta_admin.html`
2. Nhập admin key để đăng nhập
3. Quản lý từ vựng (thêm/sửa/xóa cặp từ)
4. Cấu hình thời gian, điểm số
5. Bắt đầu/kết thúc game

### Bảng xếp hạng
- Truy cập `http://localhost:3000/scoreboard.html` để xem điểm số realtime

## ⚙️ Cấu hình

Các thông số mặc định trong database:
- **Thời gian**: 120 giây
- **Điểm ghép đúng**: +10 điểm
- **Phạt ghép sai**: -2 điểm

## 📝 Scripts

| Script | Mô tả |
|--------|-------|
| `npm run dev` | Chạy development với ts-node |
| `npm run build` | Compile TypeScript sang JavaScript |
| `npm start` | Chạy production server |

## 📄 License

ISC
