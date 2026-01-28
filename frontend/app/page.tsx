'use client';

import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import VideoPlayer, { VideoPlayerRef } from '@/components/VideoPlayer';
import { Upload, MessageSquare, FileVideo, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import clsx from 'clsx';

const API_URL = 'http://localhost:8000';

interface Citation {
  text: string;
  start_time: number;
  confidence_score: number;
}

interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
  citations?: Citation[];
}

interface PastMeeting {
  id: string;
  status: string;
  created_at: string;
  filename: string | null;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('IDLE'); // IDLE, UPLOADING, PROCESSING, COMPLETED, FAILED
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Chat State
  const [query, setQuery] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { role: 'ai', content: "Welcome! Upload a video to start. Test timestamp: [@5.0s]" }
  ]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Previous meetings
  const [pastMeetings, setPastMeetings] = useState<PastMeeting[]>([]);
  const [isLoadingPastMeetings, setIsLoadingPastMeetings] = useState(false);
  const [isPastMeetingsExpanded, setIsPastMeetingsExpanded] = useState(true);

  const videoRef = useRef<VideoPlayerRef>(null);

  // Polling for status
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (meetingId && status !== 'COMPLETED' && status !== 'FAILED') {
      interval = setInterval(async () => {
        try {
          const res = await axios.get(`${API_URL}/status/${meetingId}`);
          const newStatus = res.data.status;
          setStatus(newStatus); // UPLOADED, TRANSCRIBING, EMBEDDING, COMPLETED

          if (newStatus === 'FAILED') {
            clearInterval(interval);
            alert(`Processing Failed: ${res.data.error_log}`);
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [meetingId, status]);

  // Fetch past meetings on mount
  useEffect(() => {
    fetchPastMeetings();
  }, []);

  const fetchPastMeetings = async () => {
    setIsLoadingPastMeetings(true);
    try {
      const res = await axios.get(`${API_URL}/meetings`);
      setPastMeetings(res.data);
    } catch (e) {
      console.error("Failed to fetch past meetings:", e);
    } finally {
      setIsLoadingPastMeetings(false);
    }
  };

  const loadPastMeeting = async (pastMeetingId: string) => {
    try {
      // Get presigned video URL
      const videoRes = await axios.get(`${API_URL}/meetings/${pastMeetingId}/video`);
      setVideoUrl(videoRes.data.url);
      setMeetingId(pastMeetingId);
      setStatus('COMPLETED');
      setChatHistory([{ role: 'ai', content: `Loaded previous meeting. You can now ask questions about it!` }]);
      setDebugMsg('');
    } catch (e) {
      console.error("Failed to load meeting:", e);
      alert("Failed to load the selected meeting.");
    }
  };

  const deleteMeeting = async (deleteId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering loadPastMeeting

    if (!confirm('Are you sure you want to delete this meeting? This will permanently remove the video and all transcripts.')) {
      return;
    }

    try {
      await axios.delete(`${API_URL}/meetings/${deleteId}`);
      // Refresh the list
      fetchPastMeetings();
      // If the deleted meeting was currently loaded, reset the session
      if (meetingId === deleteId) {
        resetSession();
      }
    } catch (e) {
      console.error("Failed to delete meeting:", e);
      alert("Failed to delete the meeting.");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      // Create a local object URL for preview
      setVideoUrl(URL.createObjectURL(selectedFile));
    }
  };

  const resetSession = () => {
    // Revoke the old object URL to free memory
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    // Reset all state
    setFile(null);
    setMeetingId(null);
    setStatus('IDLE');
    setUploadProgress(0);
    setVideoUrl(null);
    setQuery('');
    setChatHistory([]);
    setDebugMsg('');
  };

  const handleUpload = async () => {
    if (!file) return;
    setStatus('UPLOADING');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post(`${API_URL}/upload`, formData, {
        onUploadProgress: (progressEvent) => {
          const percent = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
          setUploadProgress(percent);
        }
      });
      setMeetingId(res.data.id);
      setStatus('UPLOADED'); // Will switch to polling
    } catch (e) {
      console.error(e);
      setStatus('FAILED');
      alert("Upload Failed");
    }
  };

  const handleChat = async () => {
    if (!query.trim() || !meetingId) return;

    const userMsg: ChatMessage = { role: 'user', content: query };
    setChatHistory(prev => [...prev, userMsg]);
    setQuery('');
    setIsChatLoading(true);

    try {
      const res = await axios.post(`${API_URL}/chat`, {
        meeting_id: meetingId,
        query: userMsg.content
      });

      const aiMsg: ChatMessage = {
        role: 'ai',
        content: res.data.ai_answer,
        citations: res.data.citations
      };
      setChatHistory(prev => [...prev, aiMsg]);
    } catch (e) {
      console.error(e);
      setChatHistory(prev => [...prev, { role: 'ai', content: "Error getting response from AI." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const [debugMsg, setDebugMsg] = useState('');

  const jumpToTimestamp = (seconds: number) => {
    console.log(`Seeking to ${seconds}s...`);
    setDebugMsg(`Seeking to ${seconds}s...`);
    // Add a small delay to ensure UI updates before heavy seek operation? No.
    if (videoRef.current) {
      videoRef.current.seekTo(seconds);
    } else {
      console.error("Video Ref is null");
      setDebugMsg(`Error: Video Ref is null`);
    }
  };

  const renderMessageContent = (content: string) => {
    // Regex matches:
    // [@12.3s], @12.3s, @12s, [ @ 12.3 s ]
    const regex = /(?:\[?\s*@\s*)(\d+(?:\.\d+)?)\s*s\s*\]?/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(content)) !== null) {
      console.log("Found match:", match[0], "Timestamp:", match[1]);
      // Push text before the match
      if (match.index > lastIndex) {
        parts.push(content.substring(lastIndex, match.index));
      }

      const timestamp = parseFloat(match[1]);

      // Push the interactive timestamp
      parts.push(
        <button
          key={match.index}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // console.log("Clicked timestamp:", timestamp);
            // alert(`Clicked timestamp: ${timestamp}`); 
            jumpToTimestamp(timestamp);
          }}
          className="bg-blue-900/50 border border-blue-500/30 text-blue-300 px-1.5 py-0.5 rounded mx-1 hover:bg-blue-800 hover:text-white transition-colors cursor-pointer inline-flex items-center"
          title={`Jump to ${timestamp}s`}
        >
          {match[0]}
        </button>
      );

      lastIndex = regex.lastIndex;
    }

    // Push remaining text
    if (lastIndex < content.length) {
      parts.push(content.substring(lastIndex));
    }

    return parts.length > 0 ? <>{parts}</> : content;
  };

  return (
    <main className="flex h-screen bg-gray-900 text-white font-sans overflow-hidden">
      {/* Sidebar / Upload Area */}
      <div className="w-1/4 min-w-[280px] max-w-[360px] bg-gray-800 border-r border-gray-700 flex flex-col h-screen overflow-hidden">
        {/* Fixed Header */}
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Smart Meeting Analyzer
          </h1>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {debugMsg && <div className="text-xs text-yellow-400 font-mono bg-gray-900 p-2 rounded">{debugMsg}</div>}

          {/* Status Card */}
          <div className="bg-gray-750 p-4 rounded-lg border border-gray-700">
            <h2 className="text-sm font-semibold text-gray-400 uppercase mb-2">System Status</h2>
            <div className="flex items-center gap-2">
              {status === 'IDLE' && <div className="w-3 h-3 rounded-full bg-gray-500" />}
              {status === 'UPLOADING' && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
              {['TRANSCRIBING', 'EMBEDDING'].includes(status) && <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />}
              {status === 'COMPLETED' && <CheckCircle className="w-4 h-4 text-green-400" />}
              {status === 'FAILED' && <AlertCircle className="w-4 h-4 text-red-500" />}

              <span className="font-mono text-sm">{status}</span>
            </div>
            {status === 'UPLOADING' && (
              <div className="w-full bg-gray-700 h-1 mt-2 rounded-full">
                <div className="bg-blue-500 h-1 rounded-full" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
          </div>

          {/* Upload */}
          {!meetingId ? (
            <div className="border-2 border-dashed border-gray-600 rounded-xl p-8 flex flex-col items-center justify-center gap-4 hover:border-blue-500 transition-colors cursor-pointer relative">
              <input
                type="file"
                accept="video/*"
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <Upload className="w-10 h-10 text-gray-400" />
              <div className="text-center">
                <p className="text-sm font-medium">Drag & drop or Click to Upload</p>
                <p className="text-xs text-gray-500 mt-1">MP4, MOV supported</p>
              </div>
              {/* Test Seek Button for Debugging */}
              {videoUrl && (
                <button
                  onClick={() => jumpToTimestamp(10)}
                  className="bg-yellow-600 px-4 py-2 rounded-lg text-sm font-bold mt-4 hover:bg-yellow-500"
                >
                  DEBUG: Seek to 10s
                </button>
              )}

              {file && (
                <div className="bg-blue-600 px-4 py-2 rounded-lg text-sm font-bold z-10 cursor-pointer" onClick={(e) => { e.stopPropagation(); handleUpload(); }}>
                  Start Processing {file.name}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-green-900/20 text-green-400 p-4 rounded-lg text-sm border border-green-900">
              <div className="flex justify-between items-start">
                <div>
                  <p>Meeting ID: <span className="font-mono">{meetingId.slice(0, 8)}...</span></p>
                  <p className="mt-1">File: {file?.name}</p>
                </div>
              </div>
              <button
                onClick={resetSession}
                className="mt-3 w-full bg-red-600/20 hover:bg-red-600/40 border border-red-500/50 text-red-400 hover:text-red-300 px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                New Meeting
              </button>
            </div>
          )}

        </div>

        {/* Previous Meetings - Collapsible */}
        <div className="border-t border-gray-700 p-4">
          <div className="flex items-center justify-between w-full mb-2">
            <button
              onClick={() => setIsPastMeetingsExpanded(!isPastMeetingsExpanded)}
              className="flex items-center gap-2 text-sm font-semibold text-gray-400 uppercase hover:text-gray-300"
            >
              <h3>Previous Meetings</h3>
              <svg
                className={clsx("w-4 h-4 transition-transform", isPastMeetingsExpanded && "rotate-180")}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              onClick={fetchPastMeetings}
              className="text-xs text-blue-400 hover:text-blue-300"
              disabled={isLoadingPastMeetings}
            >
              {isLoadingPastMeetings ? '...' : '↻'}
            </button>
          </div>

          {isPastMeetingsExpanded && (
            <>
              {pastMeetings.length === 0 ? (
                <p className="text-xs text-gray-500">No completed meetings yet.</p>
              ) : (
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {pastMeetings.map((pm) => (
                    <div
                      key={pm.id}
                      className={clsx(
                        "w-full p-2 rounded-lg text-xs transition-colors border flex items-start justify-between gap-2",
                        meetingId === pm.id
                          ? "bg-blue-600/20 border-blue-500/50 text-blue-300"
                          : "bg-gray-700/50 border-gray-600 text-gray-300 hover:bg-gray-700 hover:border-gray-500"
                      )}
                    >
                      <button
                        onClick={() => loadPastMeeting(pm.id)}
                        className="flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <FileVideo className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{pm.filename || pm.id.slice(0, 8)}</span>
                        </div>
                        <p className="text-gray-500 mt-1 text-[10px]">
                          {new Date(pm.created_at).toLocaleDateString()}
                        </p>
                      </button>
                      <button
                        onClick={(e) => deleteMeeting(pm.id, e)}
                        className="p-1 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        title="Delete meeting"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Video Area */}
        <div className="h-1/2 bg-black border-b border-gray-700 relative group">
          <VideoPlayer ref={videoRef} url={videoUrl} />
        </div>

        {/* Chat Area */}
        <div className="h-1/2 flex flex-col bg-gray-900">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {chatHistory.length === 0 && (
              <div className="text-center text-gray-500 mt-10">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>Ask any question about the meeting context.</p>
              </div>
            )}
            {chatHistory.map((msg, i) => (
              <div key={i} className={clsx("flex flex-col gap-2 max-w-3xl", msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start")}>
                <div className={clsx("px-4 py-3 rounded-2xl text-sm",
                  msg.role === 'user' ? "bg-blue-600 text-white rounded-br-none" : "bg-gray-800 text-gray-100 rounded-bl-none border border-gray-700"
                )}>
                  {renderMessageContent(msg.content)}
                </div>

                {/* Citations */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {msg.citations.map((cite, cId) => (
                      <button
                        key={cId}
                        onClick={() => jumpToTimestamp(cite.start_time)}
                        className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 px-3 py-1.5 rounded-lg text-xs transition-colors group text-left"
                      >
                        <div className="w-1 h-8 bg-green-500 rounded-full" style={{ opacity: cite.confidence_score }} />
                        <div>
                          <span className="text-blue-400 font-mono">@{cite.start_time.toFixed(1)}s</span>
                          <p className="text-gray-400 line-clamp-1 max-w-[200px]">{cite.text}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {isChatLoading && (
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Thinking...
              </div>
            )}
          </div>

          <div className="p-4 bg-gray-800 border-t border-gray-700">
            <div className="relative max-w-4xl mx-auto">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                placeholder="E.g., What was discussed about the notifications feature?"
                className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-white placeholder-gray-500"
                disabled={status !== 'COMPLETED' && status !== 'FAILED'} // Only chat when ready? Or allow query whenever? Usually RAG needs data.
              />
              <button
                onClick={handleChat}
                disabled={isChatLoading || !query.trim()}
                className="absolute right-2 top-2 p-1.5 bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <MessageSquare className="w-4 h-4 text-white" />
              </button>
            </div>
            {status !== 'COMPLETED' && status !== 'IDLE' && (
              <p className="text-center text-xs text-yellow-500 mt-2">Wait for processing to complete before asking questions.</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
