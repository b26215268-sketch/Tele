import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  Target, 
  CheckCircle2, 
  Clock, 
  Calendar, 
  TrendingUp, 
  AlertCircle, 
  ChevronRight, 
  Sparkles, 
  MapPin, 
  Compass,
  ArrowRight
} from 'lucide-react';
import { Assignment, Station, AppUser } from '../types';
import { User } from 'firebase/auth';
import { cn } from '../lib/utils';
import { Button } from './ui/Button';

interface StaffMonthlyKpiCardProps {
  user: User;
  currentAppUser: AppUser | null;
  assignments: Assignment[];
  stations: Station[];
  selectedMonth: string; // format 'yyyy-MM'
  onMonthChange: (month: string) => void;
  activeFilter: 'month' | 'today' | 'pending' | 'completed';
  onFilterChange: (filter: 'month' | 'today' | 'pending' | 'completed') => void;
  onNavigateToPlanner: () => void;
}

export function StaffMonthlyKpiCard({
  user,
  currentAppUser,
  assignments,
  stations,
  selectedMonth,
  onMonthChange,
  activeFilter,
  onFilterChange,
  onNavigateToPlanner
}: StaffMonthlyKpiCardProps) {
  // Calculate date numbers for the selected month
  const { totalDaysInMonth, remainingDays, currentDay, isCurrentMonth } = useMemo(() => {
    const today = new Date();
    const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const [y, m] = selectedMonth.split('-').map(Number);
    const lastDayOfMonth = new Date(y, m, 0).getDate();
    
    const isCur = selectedMonth === currentYearMonth;
    const curDay = isCur ? today.getDate() : (selectedMonth < currentYearMonth ? lastDayOfMonth : 1);
    const remDays = isCur ? Math.max(1, lastDayOfMonth - curDay + 1) : (selectedMonth < currentYearMonth ? 0 : lastDayOfMonth);

    return {
      totalDaysInMonth: lastDayOfMonth,
      currentDay: curDay,
      remainingDays: remDays,
      isCurrentMonth: isCur
    };
  }, [selectedMonth]);

  // Filter assignments matching current user for the selected month
  const userMonthAssignments = useMemo(() => {
    return assignments.filter(a => {
      // Check if assignment falls into selected month
      const aMonth = a.deadline ? a.deadline.substring(0, 7) : (a.startDate ? a.startDate.substring(0, 7) : '');
      if (aMonth !== selectedMonth) return false;
      return true;
    });
  }, [assignments, selectedMonth]);

  // Compute key metrics
  const totalAssigned = userMonthAssignments.length;
  const completedCount = userMonthAssignments.filter(a => a.status === 'completed').length;
  const checkedInCount = userMonthAssignments.filter(a => a.status === 'checked_in').length;
  const pendingCount = totalAssigned - completedCount;

  const percentage = totalAssigned > 0 ? Math.round((completedCount / totalAssigned) * 100) : 0;

  // Pace calculation: how many stations need to be finished per remaining day
  const dailyPaceNeeded = useMemo(() => {
    if (pendingCount <= 0) return 0;
    if (remainingDays <= 0) return pendingCount;
    const pace = pendingCount / remainingDays;
    return Math.round(pace * 10) / 10; // 1 decimal place
  }, [pendingCount, remainingDays]);

  // Determine health state & motivating message
  const statusTheme = useMemo(() => {
    if (totalAssigned === 0) {
      return {
        badge: 'Chưa có chỉ tiêu',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
        barColor: 'bg-slate-300',
        message: 'Bạn chưa có danh sách phân công khảo sát trong tháng này. Liên hệ Quản lý nếu cần bổ sung việc.',
        icon: Clock,
        iconColor: 'text-slate-500'
      };
    }
    if (percentage === 100) {
      return {
        badge: 'Hoàn thành 100%',
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
        barColor: 'bg-gradient-to-r from-emerald-500 to-teal-500',
        message: 'Xuất sắc! Bạn đã hoàn thành 100% tất cả các trạm được giao trong tháng!',
        icon: Sparkles,
        iconColor: 'text-emerald-500'
      };
    }
    if (percentage >= 70) {
      return {
        badge: 'Tiến độ rất tốt',
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
        barColor: 'bg-gradient-to-r from-emerald-500 to-blue-500',
        message: `Đã hoàn thành ${percentage}%. Bạn đang duy trì phong độ rất tốt để về đích sớm.`,
        icon: TrendingUp,
        iconColor: 'text-emerald-500'
      };
    }
    if (percentage >= 40) {
      return {
        badge: 'Đang theo đúng lịch',
        badgeClass: 'bg-blue-100 text-blue-800 border-blue-300',
        barColor: 'bg-gradient-to-r from-blue-500 to-indigo-500',
        message: `Đã hoàn thành ${percentage}%. Cần làm đều đặn ~${dailyPaceNeeded} trạm/ngày để hoàn thành chỉ tiêu.`,
        icon: TrendingUp,
        iconColor: 'text-blue-500'
      };
    }
    // Low progress
    if (remainingDays <= 7 && pendingCount > 5) {
      return {
        badge: 'Cần tăng tốc độ',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
        barColor: 'bg-gradient-to-r from-amber-500 to-rose-500',
        message: `Chú ý: Chỉ còn ${remainingDays} ngày trong tháng. Cần khảo sát ~${dailyPaceNeeded} trạm/ngày!`,
        icon: AlertCircle,
        iconColor: 'text-rose-500'
      };
    }
    return {
      badge: 'Đang thực hiện',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
      barColor: 'bg-gradient-to-r from-amber-500 to-blue-500',
      message: `Còn ${pendingCount} trạm chưa hoàn tất. Đề xuất hoàn thành ~${dailyPaceNeeded} trạm/ngày.`,
      icon: Clock,
      iconColor: 'text-amber-500'
    };
  }, [percentage, totalAssigned, remainingDays, pendingCount, dailyPaceNeeded]);

  const StatusIcon = statusTheme.icon;

  return (
    <div className="bg-white rounded-3xl p-4 sm:p-6 shadow-sm border border-slate-200/80 space-y-4">
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
            <Target className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-slate-900 text-base sm:text-lg">
                Chỉ tiêu & Tiến độ Khảo sát Tháng
              </h3>
              <span className={cn("text-[11px] font-bold px-2.5 py-0.5 rounded-full border", statusTheme.badgeClass)}>
                {statusTheme.badge}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Kỹ sư: <strong className="text-slate-700">{user.displayName || currentAppUser?.displayName || user.email}</strong>
              {currentAppUser?.department && ` · ${currentAppUser.department}`}
            </p>
          </div>
        </div>

        {/* Month Selector */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>Tháng:</span>
            <input 
              type="month"
              value={selectedMonth}
              onChange={(e) => e.target.value && onMonthChange(e.target.value)}
              className="bg-transparent font-bold text-slate-900 outline-none cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* 4 Stat Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Total Goal */}
        <div 
          onClick={() => onFilterChange('month')}
          className={cn(
            "p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between",
            activeFilter === 'month' 
              ? "bg-blue-50/70 border-blue-300 ring-2 ring-blue-500/20 shadow-xs" 
              : "bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/70"
          )}
        >
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Chỉ tiêu giao</span>
            <Target className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-slate-900 tracking-tight">
              {totalAssigned} <span className="text-xs font-semibold text-slate-500">trạm</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Tổng số được phân công
            </div>
          </div>
        </div>

        {/* Card 2: Completed */}
        <div 
          onClick={() => onFilterChange('completed')}
          className={cn(
            "p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between",
            activeFilter === 'completed' 
              ? "bg-emerald-50/70 border-emerald-300 ring-2 ring-emerald-500/20 shadow-xs" 
              : "bg-slate-50/70 border-slate-200/80 hover:bg-emerald-50/40"
          )}
        >
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Đã hoàn thành</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-emerald-600 tracking-tight">
              {completedCount} <span className="text-xs font-semibold text-emerald-700">trạm</span>
            </div>
            <div className="text-[11px] text-emerald-700/80 font-medium mt-0.5 flex items-center gap-1">
              Đạt <strong>{percentage}%</strong> chỉ tiêu
            </div>
          </div>
        </div>

        {/* Card 3: Remaining / Pending */}
        <div 
          onClick={() => onFilterChange('pending')}
          className={cn(
            "p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between",
            activeFilter === 'pending' 
              ? "bg-amber-50/70 border-amber-300 ring-2 ring-amber-500/20 shadow-xs" 
              : "bg-slate-50/70 border-slate-200/80 hover:bg-amber-50/40"
          )}
        >
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Chưa thực hiện</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-amber-600 tracking-tight">
              {pendingCount} <span className="text-xs font-semibold text-amber-700">trạm</span>
            </div>
            <div className="text-[11px] text-amber-700/80 font-medium mt-0.5">
              {checkedInCount > 0 ? `${checkedInCount} trạm đang check-in` : 'Cần bố trí lộ trình'}
            </div>
          </div>
        </div>

        {/* Card 4: Days Remaining & Pace */}
        <div className="p-3.5 rounded-2xl border bg-indigo-50/50 border-indigo-200/70 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-indigo-700 font-medium">
            <span>Thời hạn còn lại</span>
            <Calendar className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-indigo-950 tracking-tight">
              {isCurrentMonth ? remainingDays : 0} <span className="text-xs font-semibold text-indigo-700">ngày</span>
            </div>
            <div className="text-[11px] text-indigo-700 font-semibold mt-0.5">
              {pendingCount > 0 && isCurrentMonth 
                ? `Cần ~${dailyPaceNeeded} trạm/ngày` 
                : (pendingCount === 0 ? '✓ Đã xong chỉ tiêu' : 'Hết tháng')}
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar with Animation */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between text-xs font-semibold">
          <span className="text-slate-700 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
            Tiến độ hoàn thành chỉ tiêu tháng:
          </span>
          <span className="text-slate-900 font-bold font-mono">
            {completedCount} / {totalAssigned} trạm ({percentage}%)
          </span>
        </div>

        <div className="w-full h-3.5 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/70 shadow-inner">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, percentage)}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className={cn("h-full rounded-full transition-all shadow-xs", statusTheme.barColor)}
          />
        </div>
      </div>

      {/* Smart Guidance & Quick Actions Bar */}
      <div className="p-3 bg-gradient-to-r from-slate-50 to-blue-50/40 rounded-2xl border border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <StatusIcon className={cn("w-5 h-5 shrink-0", statusTheme.iconColor)} />
          <p className="text-xs text-slate-700 font-medium">
            {statusTheme.message}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {pendingCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className={cn(
                "text-xs font-bold rounded-xl py-1 px-3 border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100",
                activeFilter === 'pending' && "ring-2 ring-amber-500/30"
              )}
              onClick={() => onFilterChange('pending')}
            >
              <MapPin className="w-3.5 h-3.5 mr-1 text-amber-600" />
              Lọc {pendingCount} trạm chưa làm
            </Button>
          )}

          <Button
            size="sm"
            className="text-xs font-bold rounded-xl py-1 px-3 bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
            onClick={onNavigateToPlanner}
          >
            <Compass className="w-3.5 h-3.5 mr-1" />
            Lập lộ trình hôm nay
            <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
