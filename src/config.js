export const firebaseConfig = {
  apiKey: "AIzaSyBbMWJbE6VWqPg4LeKBO7WUz3H6e8GcPQw",
  authDomain: "horarios-data.firebaseapp.com",
  projectId: "horarios-data",
  storageBucket: "horarios-data.appspot.com",
  messagingSenderId: "246551180733",
  appId: "1:246551180733:web:98d9f2187f245f37f20ed4"
};

function generateTimeSlots(){
  const out = [];
  let h=6, m=0;
  for(let i=0;i<40;i++){
    out.push({index:i,label:String(h).padStart(2,'0')+":"+String(m).padStart(2,'0'),h,m});
    m+=30; if(m>=60){m=0; h++; if(h===24) h=0;}
  }
  return out;
}

export const SLOTS = generateTimeSlots();
