import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Search, Filter, History, MapPin, User, FileSpreadsheet, Eye, Calendar as CalendarIcon, Clock, X, Trash2 } from 'lucide-react';
import { Report, Station, TaskGroup, AuditLog, EquipmentDict } from '../types';
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

interface Props {
  reports: Report[];
  stations: Station[];
  taskGroups: TaskGroup[];
  equipmentDict: EquipmentDict[];
}

export function ReportManagementTab({ reports, stations, taskGroups, equipmentDict }: Props) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTaskGroup, setFilterTaskGroup] = useState<string>('ALL');
  const [filterDate, setFilterDate] = useState<string>('');
  
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [viewingAuditReportId, setViewingAuditReportId] = useState<string | null>(null);
  
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
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Thống kê & Quản lý Báo cáo</h2>
          <p className="text-sm text-gray-500">Giám sát tổng thể hoạt động, theo dõi nhật ký tác động (Audit Log).</p>
        </div>
        <Button onClick={exportToExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2 shadow-lg shadow-emerald-500/20">
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
                        <div className="text-gray-800 line-clamp-2 max-w-xs" title={report.content}>
                          {report.content}
                        </div>
                        {report.equipmentDetails && report.equipmentDetails.length > 0 && (
                          <div className="text-[10px] text-gray-500 mt-1 font-medium">
                            + {report.equipmentDetails.length} VTư
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-col gap-2 w-24">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-8 px-2 text-indigo-600 border-indigo-200 hover:bg-indigo-50 flex items-center justify-center w-full gap-1"
                            onClick={() => setViewingAuditReportId(report.id)}
                          >
                            <History className="w-3 h-3" /> Audit
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-8 px-2 text-red-600 border-red-200 hover:bg-red-50 flex items-center justify-center w-full gap-1"
                            onClick={(e) => { e.stopPropagation(); handleDeleteReport(report); }}
                          >
                            <Trash2 className="w-3 h-3" /> Xóa
                          </Button>
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
