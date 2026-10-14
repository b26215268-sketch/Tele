const fs = require('fs');
let code = fs.readFileSync('src/pages/StationsTab.tsx', 'utf8');

// The file has some weird corrupted text at lines 750+. Let's just fix the whole render function.
// Let's do a basic regex replacement to fix the mapping of expandedStation

// Better idea: I will just use regex to clean up the duplicated and corrupted HTML elements.

let startIndex = code.indexOf('<div className="flex items-center gap-0.5 shrink-0 ml-auto -mr-2">');
let endIndex = code.indexOf('{filteredStations.length === 0 && (');

if (startIndex !== -1 && endIndex !== -1) {
  let replacement = `                  <div className="flex items-center gap-0.5 shrink-0 ml-auto -mr-2">
                    <button 
                      onClick={(e) => { e.stopPropagation(); setEditingStation(station); }}
                      className="p-2.5 sm:p-2 text-gray-400 hover:text-blue-600 transition-colors bg-gray-50/50 hover:bg-blue-50 rounded-lg sm:rounded-full ml-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDelete(station.id); }}
                      className="p-2.5 sm:p-2 text-gray-400 hover:text-red-600 transition-colors bg-gray-50/50 hover:bg-red-50 rounded-lg sm:rounded-full"
                    >
                      <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {expandedStationId === station.id && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }} 
                      animate={{ height: 'auto', opacity: 1 }} 
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="pt-4 mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-gray-900">Thông tin địa chỉ</h4>
                            <span className={cn(
                              "text-xs px-2 py-1 rounded-full font-medium",
                              station.status === 'checked' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            )}>
                              {station.status === 'checked' ? 'Đã kiểm tra' : 'Chưa kiểm tra'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                              <MapPin className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="font-medium text-gray-900">{station.address || 'Chưa cập nhật'}</div>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold text-gray-900 flex items-center justify-between">
                            Vị trí bản đồ
                            <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const message = \`Trạm: \${station.name}\${station.infrastructureCode ? \` (\${station.infrastructureCode})\` : ''}\\nĐịa chỉ: \${station.address}\\nTọa độ: \${station.latitude}, \${station.longitude}\\nDẫn đường: https://www.google.com/maps/search/?api=1&query=\${station.latitude},\${station.longitude}\`;
                                  if (navigator.share) {
                                    navigator.share({ title: \`Vị trí trạm \${station.name}\`, text: message }).catch(console.error);
                                  } else {
                                    navigator.clipboard.writeText(message).then(() => alert('Đã copy tọa độ vào bộ nhớ đệm!'));
                                  }
                                }}
                                className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full font-medium hover:bg-blue-100 flex items-center gap-1 transition-colors"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>
                                Chia sẻ
                              </button>
                          </h4>
                          <a 
                            href={\`https://www.google.com/maps/dir/?api=1&destination=\${station.latitude},\${station.longitude}\`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 p-3 bg-blue-50 hover:bg-blue-100 transition-colors rounded-lg group"
                          >
                            <div className="w-10 h-10 rounded-full bg-blue-200 flex items-center justify-center text-blue-700">
                              <Navigation className="w-5 h-5 group-hover:scale-110 transition-transform" />
                            </div>
                            <div>
                              <div className="font-medium text-blue-900">Mở Google Maps</div>
                              <div className="text-xs text-blue-700 mt-0.5">
                                {station.latitude}, {station.longitude}
                              </div>
                            </div>
                          </a>
                        </div>
                      </div>

                      {station.additionalFields && Object.keys(station.additionalFields).length > 0 && (
                        <div className="mt-2 pt-3 border-t border-gray-100">
                          <h4 className="text-sm font-semibold text-gray-900 mb-3">Thông tin mở rộng</h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {Object.entries(station.additionalFields).map(([k, v]) => (
                               <div key={k} className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                                 <div className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1 truncate">{k}</div>
                                 <div className="text-sm font-medium text-gray-900 truncate" title={v as string}>{v as React.ReactNode}</div>
                               </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </Card>
        ))}
        `;

  code = code.substring(0, startIndex) + replacement + code.substring(endIndex);
  fs.writeFileSync('src/pages/StationsTab.tsx', code);
  console.log("File patched!");
} else {
  console.log("Could not find start/end bounds.");
}
