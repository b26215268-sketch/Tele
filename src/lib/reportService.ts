import { collection, doc, setDoc, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Station, Report, TaskGroup, Attachment } from '../types';

/**
 * 1. Khai báo các thực thể (Entities/Models) đã được định nghĩa trong /src/types.ts
 * - Tham khảo: Station (Trạm), TaskGroup (Nhóm Công Việc), Report (Báo Cáo), 
 *              Attachment (Đính kèm), ReportHistory (Lịch sử)
 */

/**
 * 3. Tạo sẵn dữ liệu mẫu (Mock data) chuyên ngành viễn thông
 */
export async function initializeMockData() {
  try {
    // 3.1. Dữ liệu mẫu Trạm (Stations)
    const stationsRef = collection(db, 'stations');
    const mockStations = [
      { id: 'HCM001', name: 'Trạm HCM001', infrastructureCode: 'HCM001', latitude: 10.762622, longitude: 106.660172, address: 'TP.HCM', managerName: 'Nguyễn Văn A', managerPhone: '0901234567', status: 'unchecked' },
      { id: 'BDG050', name: 'Trạm BDG050', infrastructureCode: 'BDG050', latitude: 10.957640, longitude: 106.661700, address: 'Bình Dương', managerName: 'Trần Văn B', managerPhone: '0987654321', status: 'checked' }
    ];

    for (const st of mockStations) {
      await setDoc(doc(stationsRef, st.id), st, { merge: true });
    }
    console.log('✅ Đã tạo Mock Data Trạm');

    // 3.2. Dữ liệu mẫu Nhóm công việc (TaskGroups)
    const taskGroupsRef = collection(db, 'taskGroups');
    const mockTaskGroups = [
      { id: 'TG01', name: 'Tích hợp trạm' },
      { id: 'TG02', name: 'Khai báo thay thế Card BB6630' },
      { id: 'TG03', name: 'Đo kiểm RET' },
      { id: 'TG04', name: 'Xử lý cảnh báo' }
    ];

    for (const tg of mockTaskGroups) {
      await setDoc(doc(taskGroupsRef, tg.id), tg, { merge: true });
    }
    console.log('✅ Đã tạo Mock Data Nhóm Công Việc');

    // Mối quan hệ: Report (Báo Cáo) chứa FK tới `userId`, `stationId`, `taskGroupId`
    // Do hệ thống có liên kết user thật, tạm thời chỉ in logic tạo Report ra log.
    console.log('✅ Cấu trúc quan hệ Firebase (NoSQL): Báo Cáo lưu trữ ID của trạm (stationId) và nhóm công việc (taskGroupId). Đính kèm (Attachments) được lưu dưới dạng array bên trong Báo Cáo (1-Nhiều).');
    
  } catch (error) {
    console.error('❌ Lỗi khi khởi tạo mock data:', error);
  }
}

/**
 * 4. Hàm mẫu lấy ra danh sách toàn bộ báo cáo công việc của một trạm cụ thể
 * @param stationId ID của trạm cần lấy báo cáo (Ví dụ: 'HCM001')
 * @returns Array chứa danh sách các báo cáo
 */
export async function getReportsByStation(stationId: string): Promise<Report[]> {
  try {
    const reportsRef = collection(db, 'reports');
    // Truy vấn tất cả báo cáo có stationId truyền vào (1-Nhiều từ Tram sang BaoCao)
    const q = query(reportsRef, where('stationId', '==', stationId));
    
    const querySnapshot = await getDocs(q);
    const reports: Report[] = [];
    
    querySnapshot.forEach((doc) => {
        reports.push({ id: doc.id, ...doc.data() } as Report);
    });
    
    return reports;
  } catch (error) {
    console.error(`❌ Lỗi khi tải báo cáo của trạm ${stationId}:`, error);
    return [];
  }
}
