// src/data/symptom_fallbacks.ts
// Pre-built for the top symptoms — hardcoded so demo always works offline

export interface SymptomGuidance {
  homeRemedies: string[];
  goToERIf: string[];
  seeDoctorIf: string[];
}

export const SYMPTOM_FALLBACKS: Record<string, SymptomGuidance> = {
  'back pain': {
    homeRemedies: [
      'Cold pack 15-20 min every 3-4 hours for the first 48 hours',
      'After 48 hours switch to a heating pad 15-20 min',
      'Gentle walking 10-15 minutes 2-3x daily — better than bed rest',
      'Ibuprofen or acetaminophen as directed on the package'
    ],
    goToERIf: [
      'Pain shoots down your leg with numbness or tingling',
      'Loss of bladder or bowel control',
      'Fever above 101°F with back pain',
      'Pain started after a fall or accident'
    ],
    seeDoctorIf: ['No improvement after 1 week', 'Pain is getting progressively worse']
  },
  'headache': {
    homeRemedies: [
      'Rest in a quiet dark room',
      'Cold or warm compress on your head or neck',
      'Drink water — dehydration is a common trigger',
      'Acetaminophen or ibuprofen as directed'
    ],
    goToERIf: [
      'Worst headache of your life — sudden and severe',
      'Headache with fever, stiff neck, confusion, or rash',
      'Headache after head injury',
      'Headache with vision changes or weakness on one side'
    ],
    seeDoctorIf: ['Headaches more than 15 days per month', 'Not responding to over-the-counter medication']
  },
  'fever': {
    homeRemedies: [
      'Rest and drink plenty of fluids',
      'Acetaminophen or ibuprofen to reduce fever',
      'Cool damp cloth on forehead',
      'Light clothing and comfortable room temperature'
    ],
    goToERIf: [
      'Fever above 103°F (39.4°C) in adults',
      'Fever with severe headache, stiff neck, or rash',
      'Fever in a baby under 3 months old',
      'Difficulty breathing with fever'
    ],
    seeDoctorIf: ['Fever lasting more than 3 days', 'Fever keeps returning after going away']
  },
  'stomach pain': {
    homeRemedies: [
      'Sip clear fluids like water or ginger tea',
      'Avoid solid food for a few hours if nauseous',
      'Try the BRAT diet: Bananas, Rice, Applesauce, Toast',
      'Avoid dairy, caffeine, and spicy foods'
    ],
    goToERIf: [
      'Severe pain that comes on suddenly',
      'Pain with vomiting blood or blood in stool',
      'Abdomen is rigid or extremely tender to touch',
      'Fever above 101°F with abdominal pain'
    ],
    seeDoctorIf: ['Pain lasting more than 48 hours', 'Recurring episodes of stomach pain']
  },
  'cough': {
    homeRemedies: [
      'Honey in warm water or tea (NOT for children under 1)',
      'Stay hydrated with warm fluids',
      'Use a humidifier or take a steamy shower',
      'Elevate your head while sleeping'
    ],
    goToERIf: [
      'Coughing up blood',
      'Severe difficulty breathing',
      'High fever (above 103°F) with cough',
      'Chest pain when breathing or coughing'
    ],
    seeDoctorIf: ['Cough lasting more than 3 weeks', 'Cough with thick green or yellow mucus']
  },
  'sore throat': {
    homeRemedies: [
      'Gargle with warm salt water (1/2 tsp salt in 8 oz water)',
      'Drink warm fluids like tea with honey',
      'Use throat lozenges or hard candy',
      'Rest your voice'
    ],
    goToERIf: [
      'Difficulty breathing or swallowing saliva',
      'Unable to open your mouth',
      'Swelling in the neck or tongue'
    ],
    seeDoctorIf: ['Sore throat lasting more than 1 week', 'Fever above 101°F for more than 2 days', 'White patches on your tonsils']
  },
  'nausea': {
    homeRemedies: [
      'Sip clear fluids slowly — water, ginger ale, or broth',
      'Try ginger tea or ginger candies',
      'Eat small, bland meals — crackers, toast, rice',
      'Avoid strong smells, greasy or spicy foods'
    ],
    goToERIf: [
      'Vomiting blood or dark "coffee ground" material',
      'Signs of dehydration — dark urine, dizziness, dry mouth',
      'Severe abdominal pain with nausea',
      'Head injury before nausea started'
    ],
    seeDoctorIf: ['Nausea lasting more than 48 hours', 'Unable to keep any fluids down for 24 hours']
  },
  'dizziness': {
    homeRemedies: [
      'Sit or lie down immediately when feeling dizzy',
      'Drink water — dehydration is a common cause',
      'Avoid sudden position changes (stand up slowly)',
      'Avoid caffeine, alcohol, and tobacco'
    ],
    goToERIf: [
      'Dizziness with chest pain or difficulty breathing',
      'Sudden severe headache with dizziness',
      'Weakness or numbness on one side of the body',
      'Dizziness after a head injury'
    ],
    seeDoctorIf: ['Recurring episodes of dizziness', 'Dizziness that interferes with daily activities']
  },
  'rash': {
    homeRemedies: [
      'Cool compress on the affected area',
      'Avoid scratching — trim fingernails short',
      'Use fragrance-free moisturizer',
      'Over-the-counter hydrocortisone cream for itching'
    ],
    goToERIf: [
      'Rash spreading rapidly over your body',
      'Rash with difficulty breathing or throat swelling',
      'Rash with high fever',
      'Painful blisters or peeling skin'
    ],
    seeDoctorIf: ['Rash lasting more than 2 weeks', 'Rash that is painful or infected-looking']
  },
  'anxiety': {
    homeRemedies: [
      'Try deep breathing: breathe in 4 seconds, hold 4, out 4',
      'Ground yourself: name 5 things you can see, 4 hear, 3 touch',
      'Limit caffeine and alcohol intake',
      'Take a walk outside if possible'
    ],
    goToERIf: [
      'Thoughts of harming yourself or others',
      'Chest pain or feeling like you\'re having a heart attack',
      'Panic attack that doesn\'t resolve after 30 minutes'
    ],
    seeDoctorIf: ['Anxiety interfering with daily life or work', 'Panic attacks happening regularly']
  },
  'default': {
    homeRemedies: [
      'Rest and get adequate sleep',
      'Stay hydrated with water or clear fluids',
      'Monitor your symptoms closely',
      'Avoid strenuous activity until symptoms improve'
    ],
    goToERIf: [
      'Symptoms are severe or worsening rapidly',
      'Difficulty breathing or chest pain',
      'High fever that doesn\'t respond to medication',
      'Loss of consciousness or confusion'
    ],
    seeDoctorIf: [
      'No improvement after 48-72 hours',
      'You are concerned about your symptoms',
      'Symptoms are recurring frequently'
    ]
  }
};
