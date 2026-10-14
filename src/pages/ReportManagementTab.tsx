import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Search, Filter, History, MapPin, User, FileSpreadsheet, Eye, Calendar as CalendarIcon, Clock, X, Trash2, FolderUp, ExternalLink, Image as ImageIcon, CheckCircle2 } from 'lucide-react';
import { Report, Station, TaskGroup, AuditLog, EquipmentDict, AppUser } from '../types';
import { format, parseISO } from 'date-fns';
import * as XLSX from 'xlsx';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firebase-utils';
import { removeVietnameseTones } from '../lib/utils';
import { isOwnerEmail } from '../lib/permissions';

interface Props {
  reports: Report[];
  stations: Station[];
  taskGroups: TaskGroup[];
  equipmentDict: EquipmentDict[];
  currentAppUser?: AppUser | null;
  user?: import('firebase/auth').User | null;
}

export function ReportManagementTab({ reports, stations, taskGroups, equipmentDict, currentAppUser, user }: Props) {
  const isAdmin = isOwnerEmail(user?.email) || currentAppUser?.role === 'admin';
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTaskGroup, setFilterTaskGroup] = useState<string>('ALL');
  const [filterDate, setFilterDate] = useState<string>('');
  
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [viewingAuditReportId, setViewingAuditReportId] = useState<string | null>(null);
  const [viewingReport, setViewingReport] = useState<Report | null>(null);
  const [selectedImageModal, setSelectedImageModal] = useState<string | null>(null);
  
  // Optimistic UI pending deletes
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());

  useEffect(() => {
    const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAuditLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'audit_logs');
    });
    return () => unsubscribe();
  }, []);

  const getTaskGroupName = (id?: string) => {
    return taskGroups.find(tg => tg.id === id)?.name || 'Khác';
  };

  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      // Optimistic delete hiding
      if (pendingDeletes.has(r.id)) return false;

      // STRICT FILTER: Only show reports for stations that exist in the currently filtered stations list (Campaign context)
      const station = stations.find(s => s.id === r.stationId);
      if (!station) return false;
      
      // Omni-search
      const lowerSearchTerms = removeVietnameseTones(searchTerm.toLowerCase().trim()).split(/\s+/).filter(Boolean);
      let searchMatch = true;
      if (lowerSearchTerms.length > 0) {
        let equipmentValues: string[] = [];
        r.equipmentDetails?.forEach(eq => {
           equipmentValues.push(equipmentDict.find(e => e.id === eq.equipmentId)?.name || eq.equipmentId);
           if (eq.status) equipmentValues.push(eq.status);
           if (eq.note) equipmentValues.push(eq.note);
        });

        const searchableArray = [
          station?.name,
          station?.infrastructureCode,
          station?.address,
          station?.managerName,
          station?.managerPhone,
          r.stationName,
          r.content,
          r.userId,
          r.userEmail,
          getTaskGroupName(r.taskGroupId),
          // Deep search in equipment
          ...equipmentValues,
          // Deep search in survey results
          ...(r.surveyResults ? Object.values(r.surveyResults) : []),
          // Deep search in infra check status
          r.infrastructureCheck?.acStatus,
          r.infrastructureCheck?.powerStatus,
          r.infrastructureCheck?.securityStatus,
          r.infrastructureCheck?.leakStatus,
          r.infrastructureCheck?.note,
          format(parseISO(r.createdAt || r.date), 'dd/MM/yyyy')
        ];
        
        const massiveString = removeVietnameseTones(searchableArray.filter(Boolean).join(' ').toLowerCase());
        searchMatch = lowerSearchTerms.every(term => massiveString.includes(term));
      }
      
      const taskGroupMatch = filterTaskGroup === 'ALL' || r.taskGroupId === filterTaskGroup;
      
      const rDate = (r.createdAt || r.date).substring(0, 10);
      const dateMatch = !filterDate || rDate === filterDate;

      return searchMatch && taskGroupMatch && dateMatch;
    }).sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date));
  }, [reports, stations, searchTerm, filterTaskGroup, filterDate, pendingDeletes, equipmentDict, taskGroups]);

  const handleDeleteReport = async (report: Report) => {
    if (!window.confirm("Bạn có chắc chắn muốn xóa báo cáo này không?\nHành động này cũng sẽ xóa toàn bộ hình ảnh đính kèm và không thể hoàn tác.")) {
      return;
    }

    // 1. Optimistic UI Update: Bỏ qua report này khỏi danh sách ngay lập tức
    setPendingDeletes(prev => new Set(prev).add(report.id));

    try {
      // 2. Chạy ngầm: Xóa Document trong Firestore
      await deleteDoc(doc(db, 'reports', report.id));

      // 3. Chạy ngầm: Gom rác (Garbage Collection) - Xóa tất cả hình ảnh trong Storage
      if (report.attachments && report.attachments.length > 0) {
        report.attachments.forEach(att => {
          if (att.url) {
            try {
               const fileRef = ref(storage, att.url);
               deleteObject(fileRef).catch(e => console.warn("Lỗi khi gom rác ảnh:", e));
            } catch (e) {
               console.warn("URL ảnh không hợp lệ để gỡ khỏi Storage", att.url);
            }
          }
        });
      }
    } catch (e: any) {
      // 4. Rollback: Nếu quá trình bị lỗi (mất mạng v.v..), trả lại report về UI
      setPendingDeletes(prev => {
        const next = new Set(prev);
        next.delete(report.id);
        return next;
      });
      alert('Không thể xóa báo cáo: ' + e.message);
    }
  };

  const exportToExcel = () => {
    const data = filteredReports.map(r => {
      const station = stations.find(s => s.id === r.stationId);
      const tg = taskGroups.find(t => t.id === r.taskGroupId);
      
      let eqCount = 0;
      if (r.equipmentDetails) {
        eqCount = r.equipmentDetails.reduce((sum, eq) => sum + eq.quantity, 0);
      }

      return {
        'Ngày thực hiện': format(parseISO(r.createdAt || r.date), 'dd/MM/yyyy HH:mm'),
        'Mã Trạm': station?.infrastructureCode || 'N/A',
        'Tên Trạm': station?.name || r.stationName,
        'Người thực hiện': r.userId, 
        'Loại Công Việc': tg?.name || 'Khác',
        'Nội dung / Ghi chú': r.content,
        'Tổng SL VTư': eqCount,
        'Ảnh đính kèm': (r.attachments?.length || 0) + ' ảnh',
        'Link Google Drive': r.googleDriveUrl || '',
        'Trạng thái': r.status === 'completed' ? 'Hoàn thành' : 'Đang xử lý'
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "BaoCao");
    XLSX.writeFile(workbook, `BaoCao_TongHop_${format(new Date(), 'yyyyMMdd')}.xlsx`);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Thống kê & Quản lý Báo cáo</h2>
            <span className={cn(
              "px-2.5 py-0.5 rounded-lg text-xs font-bold border",
              isAdmin ? "bg-purple-100 text-purple-800 border-purple-200" : "bg-blue-100 text-blue-800 border-blue-200"
            )}>
              {isAdmin ? '👑 Quản trị viên (Admin)' : '💼 Quản lý (Manager)'}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">Giám sát tổng thể hoạt động các trạm, theo dõi nhật ký thay đổi (Audit Log) và xuất dữ liệu.</p>
        </div>
        <Button onClick={exportToExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2 shadow-lg shadow-emerald-500/20 font-bold">
          <FileSpreadsheet className="w-4 h-4" /> Xuất Excel ({filteredReports.length})
        </Button>
      </div>

      <Card className="p-4 bg-white shadow-sm border-gray-200">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input 
              placeholder="Tìm theo trạm, nội dung..." 
              value={searchTerm}
              onChange={(e: any) => setSearchTerm(e.target.value)}
              className="pl-9 h-10 w-full"
            />
          </div>
          <div className="w-full sm:w-48">
            <select 
              className="w-full h-10 border border-gray-200 rounded-lg text-sm bg-white px-3 focus:ring-2 focus:ring-blue-500"
              value={filterTaskGroup}
              onChange={(e) => setFilterTaskGroup(e.target.value)}
            >
              <option value="ALL">Tất cả công việc</option>
              {taskGroups.map(tg => <option key={tg.id} value={tg.id}>{tg.name}</option>)}
            </select>
          </div>
          <div className="w-full sm:w-48 relative">
            <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
            <input 
              type="date"
              className="w-full h-10 border border-gray-200 rounded-lg text-sm bg-white pl-9 pr-3 focus:ring-2 focus:ring-blue-500"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
            />
          </div>
        </div>
      </Card>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 bg-gray-50 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-semibold">Trạm</th>
                <th className="px-4 py-3 font-semibold">Công việc</th>
                <th className="px-4 py-3 font-semibold">Nhân sự</th>
                <th className="px-4 py-3 font-semibold">Thời gian</th>
                <th className="px-4 py-3 font-semibold">Nội dung tóm tắt</th>
                <th className="px-4 py-3 font-semibold text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredReports.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <Search className="w-10 h-10 text-gray-300 mb-3" />
                      <p>Không có dữ liệu báo cáo phù hợp bộ lọc.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredReports.map(report => {
                  const station = stations.find(s => s.id === report.stationId);
                  return (
                    <tr key={report.id} className="hover:bg-blue-50/50 transition-colors">
                      <td className="px-4 py-3 align-top">
                        <div className="font-bold text-gray-900">{station?.name || report.stationName}</div>
                        <div className="text-xs text-gray-500 font-mono mt-0.5">{station?.infrastructureCode}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="inline-flex px-2 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded">
                          {getTaskGroupName(report.taskGroupId)}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-gray-600">
                        <div className="truncate w-32" title={report.userId}>{report.userId}</div>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-gray-600">
                          <Clock className="w-3.5 h-3.5" />
                          {format(parseISO(report.createdAt || report.date), 'HH:mm dd/MM/yy')}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="text-gray-800 line-clamp-2 max-w-xs font-medium" title={report.content}>
                          {report.content}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {report.equipmentDetails && report.equipmentDetails.length > 0 && (
                            <span className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded font-medium border border-gray-200">
                              + {report.equipmentDetails.length} VTư
                            </span>
                          )}
                          {report.attachments && report.attachments.length > 0 && (
                            <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium border border-blue-200 flex items-center gap-0.5">
                              <ImageIcon className="w-2.5 h-2.5" /> {report.attachments.length} ảnh
                            </span>
                          )}
                          {report.googleDriveUrl && (
                            <a
                              href={report.googleDriveUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[10px] bg-amber-50 hover:bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium border border-amber-200 flex items-center gap-1 transition-colors"
                              title="Mở thư mục Google Drive chứa ảnh"
                            >
                              <FolderUp className="w-2.5 h-2.5 text-amber-600" />
                              <span>Drive</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-col gap-1.5 w-24">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 px-2 text-blue-600 border-blue-200 hover:bg-blue-50 flex items-center justify-center w-full gap-1 text-xs font-semibold"
                            onClick={() => setViewingReport(report)}
                          >
                            <Eye className="w-3 h-3" /> Chi tiết
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 px-2 text-indigo-600 border-indigo-200 hover:bg-indigo-50 flex items-center justify-center w-full gap-1 text-xs"
                            onClick={() => setViewingAuditReportId(report.id)}
                          >
                            <History className="w-3 h-3" /> Audit
                          </Button>
                          {isAdmin ? (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-7 px-2 text-red-600 border-red-200 hover:bg-red-50 flex items-center justify-center w-full gap-1 text-xs"
                              onClick={(e) => { e.stopPropagation(); handleDeleteReport(report); }}
                            >
                              <Trash2 className="w-3 h-3" /> Xóa
                            </Button>
                          ) : (
                            <span className="text-[10px] text-gray-400 text-center italic py-0.5">
                              (Chỉ xem)
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {/* Full Report Detail Modal */}
        {viewingReport && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
            onClick={() => setViewingReport(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/70">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-600 text-white rounded-xl shadow-sm">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-base sm:text-lg">
                      {stations.find(s => s.id === viewingReport.stationId)?.name || viewingReport.stationName || 'Báo cáo trạm'}
                    </h3>
                    <p className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                      <span>Mã trạm: <strong className="font-mono text-gray-700">{stations.find(s => s.id === viewingReport.stationId)?.infrastructureCode || 'N/A'}</strong></span>
                      <span>•</span>
                      <span>{format(parseISO(viewingReport.createdAt || viewingReport.date), 'dd/MM/yyyy HH:mm')}</span>
                    </p>
                  </div>
                </div>
                <button onClick={() => setViewingReport(null)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
                {/* Meta info */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-gray-50 rounded-xl border border-gray-200/70 text-xs">
                  <div>
                    <span className="text-gray-500 block mb-0.5">Loại công việc</span>
                    <span className="font-bold text-blue-700 bg-blue-100/70 px-2 py-0.5 rounded inline-block">
                      {getTaskGroupName(viewingReport.taskGroupId)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 block mb-0.5">Người thực hiện</span>
                    <span className="font-medium text-gray-800 break-words">{viewingReport.userEmail || viewingReport.userId}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block mb-0.5">Trạng thái</span>
                    <span className="font-bold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Đã hoàn thành
                    </span>
                  </div>
                </div>

                {/* Content & Notes */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">Nội dung / Ghi chú</h4>
                  <div className="p-3 bg-gray-50/80 rounded-xl border border-gray-100 text-sm text-gray-800 whitespace-pre-wrap">
                    {viewingReport.content || 'Không có ghi chú thêm.'}
                  </div>
                </div>

                {/* Google Drive Link Section if present */}
                {viewingReport.googleDriveUrl && (
                  <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0 shadow-xs">
                        <FolderUp className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-amber-950">Album ảnh Google Drive đính kèm</h4>
                        <p className="text-xs text-amber-800 mt-0.5">
                          Báo cáo có đính kèm link thư mục Google Drive chứa ảnh chụp gốc chất lượng cao / số lượng lớn.
                        </p>
                      </div>
                    </div>
                    <a
                      href={viewingReport.googleDriveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-500/20 flex items-center gap-1.5 transition-all self-end sm:self-auto flex-shrink-0"
                    >
                      <span>Mở Google Drive</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}

                {/* Equipment / Materials Table */}
                {viewingReport.equipmentDetails && viewingReport.equipmentDetails.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                      Chi tiết vật tư & thiết bị ({viewingReport.equipmentDetails.length})
                    </h4>
                    <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                          <tr>
                            <th className="px-3 py-2 text-left">Không gian</th>
                            <th className="px-3 py-2 text-left">Thiết bị</th>
                            <th className="px-3 py-2 text-center">Số lượng</th>
                            <th className="px-3 py-2 text-left">Tình trạng</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {viewingReport.equipmentDetails.map((eq, idx) => {
                            const eqInfo = equipmentDict.find(e => e.id === eq.equipmentId || e.name === eq.equipmentId);
                            return (
                              <tr key={idx} className="hover:bg-gray-50/50">
                                <td className="px-3 py-2 font-medium text-gray-700">{eq.spaceId}</td>
                                <td className="px-3 py-2 font-bold text-gray-900">{eqInfo?.name || eq.equipmentId}</td>
                                <td className="px-3 py-2 text-center font-bold text-blue-600">
                                  {eq.quantity} {eq.unit || eqInfo?.unit || ''}
                                </td>
                                <td className="px-3 py-2 text-gray-600">{eq.status || 'Tốt'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Photo Gallery with watermark preview */}
                {viewingReport.attachments && viewingReport.attachments.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
                      <ImageIcon className="w-4 h-4 text-gray-400" />
                      Hình ảnh hiện trường ({viewingReport.attachments.length} ảnh)
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {viewingReport.attachments.map((att, idx) => (
                        <div 
                          key={att.id || idx}
                          onClick={() => setSelectedImageModal(att.url)}
                          className="relative aspect-video rounded-xl overflow-hidden border border-gray-200 cursor-pointer group bg-gray-100 hover:shadow-md transition-all"
                        >
                          <img src={att.url} alt={`Ảnh ${idx + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                          <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] px-2 py-1 flex items-center justify-between">
                            <span className="capitalize">{att.category || 'Ảnh'}</span>
                            <Eye className="w-3 h-3 opacity-75 group-hover:opacity-100" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    setViewingAuditReportId(viewingReport.id);
                  }}
                  className="text-xs text-indigo-600 border-indigo-200 hover:bg-indigo-50 flex items-center gap-1.5"
                >
                  <History className="w-3.5 h-3.5" /> Xem lịch sử Audit
                </Button>
                <Button onClick={() => setViewingReport(null)} className="text-xs">
                  Đóng
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* Lightbox Photo Zoom Modal */}
        {selectedImageModal && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setSelectedImageModal(null)}
          >
            <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
              <button 
                onClick={() => setSelectedImageModal(null)}
                className="absolute -top-10 right-0 text-white/80 hover:text-white p-1 rounded-full"
              >
                <X className="w-6 h-6" />
              </button>
              <img 
                src={selectedImageModal} 
                alt="Enlarged" 
                className="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain"
                onClick={e => e.stopPropagation()}
              />
            </div>
          </motion.div>
        )}

        {/* Audit Trail Modal */}
        {viewingAuditReportId && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
            onClick={() => setViewingAuditReportId(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-100 text-indigo-600 rounded-lg">
                    <History className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Lịch sử tác động (Audit Trail)</h3>
                  </div>
                </div>
                <button onClick={() => setViewingAuditReportId(null)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                {(() => {
                  const logs = auditLogs.filter(l => l.reportId === viewingAuditReportId).sort((a,b) => b.timestamp.localeCompare(a.timestamp));
                  
                  if (logs.length === 0) {
                    return <div className="text-center py-10 text-gray-400">Chưa có lịch sử thay đổi (hoặc tính năng log mới được bật).</div>;
                  }

                  return (
                    <div className="relative border-l-2 border-indigo-100 ml-3 pl-5 space-y-6">
                      {logs.map((log, index) => (
                        <div key={log.id || index} className="relative">
                          <div className="absolute -left-[27px] top-1 w-3.5 h-3.5 bg-indigo-600 border-4 border-white rounded-full shadow-sm"></div>
                          <div className="bg-white border border-gray-100 shadow-sm rounded-xl p-3 sm:p-4">
                            <div className="flex flex-col flex-wrap sm:flex-row sm:items-center justify-between gap-2 mb-2">
                              <span className={cn(
                                "text-xs font-bold px-2 py-0.5 rounded-full inline-block uppercase w-max",
                                log.action === 'CREATE' ? "bg-green-100 text-green-700" :
                                log.action === 'UPDATE' ? "bg-amber-100 text-amber-700" :
                                "bg-red-100 text-red-700"
                              )}>
                                {log.action}
                              </span>
                              <span className="text-xs font-medium text-gray-500 font-mono">
                                {format(parseISO(log.timestamp), 'dd/MM/yyyy HH:mm:ss')}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-gray-800">
                              <User className="w-4 h-4 text-gray-400" />
                              {log.userEmail || log.userId}
                            </div>
                            <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded-lg break-words">
                              {log.changes}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
