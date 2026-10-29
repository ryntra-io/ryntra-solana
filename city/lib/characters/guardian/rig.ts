import { defineRig, mirrored, mirroredAims } from '../rig.ts';

/**
 * The vault guardian's skeleton: a sleek humanoid about 1.97 units tall — human proportions, a little taller than a
 * person, legs half its height, shoulders a quarter of it across, the head above them. One unit is about a metre of
 * the guardian; the scene scales it.
 *
 *   pelvis → spine → chest → neck → head
 *                    chest → clavicle → upperArm → foreArm → hand → fingers → tips, hand → thumb   (L and R)
 *   pelvis → thigh → shin → foot                                                                  (L and R)
 *
 * Tendons at the back of each elbow and knee are aimed, not posed: they stretch across the joint as it bends. The legs
 * (and the ankle's height, `ANKLE` in pose.ts) are the first guardian's, so every clip's feet and hips still land.
 */
export const GUARDIAN_RIG = defineRig(
  mirrored([
    { name: 'pelvis', parent: null, at: [0, 1.03, 0] },
    { name: 'spine', parent: 'pelvis', at: [0, 0.12, -0.01] },
    { name: 'chest', parent: 'spine', at: [0, 0.22, 0] },
    { name: 'neck', parent: 'chest', at: [0, 0.3, 0.02] },
    { name: 'head', parent: 'neck', at: [0, 0.09, 0.02] },
    { name: 'clavicle.L', parent: 'chest', at: [0.05, 0.22, -0.01] },
    { name: 'upperArm.L', parent: 'clavicle.L', at: [0.16, -0.04, 0] },
    { name: 'foreArm.L', parent: 'upperArm.L', at: [0, -0.29, 0] },
    { name: 'hand.L', parent: 'foreArm.L', at: [0, -0.27, 0] },
    { name: 'fingers.L', parent: 'hand.L', at: [0, -0.1, 0.005] },
    { name: 'tips.L', parent: 'fingers.L', at: [0, -0.05, 0] },
    { name: 'thumb.L', parent: 'hand.L', at: [-0.018, -0.035, 0.035] },
    { name: 'thigh.L', parent: 'pelvis', at: [0.11, -0.06, 0] },
    { name: 'shin.L', parent: 'thigh.L', at: [0, -0.45, 0] },
    { name: 'foot.L', parent: 'shin.L', at: [0, -0.42, 0] },
  ]),
  mirroredAims([
    { name: 'armPiston.L', from: 'upperArm.L', fromAt: [0, -0.1, -0.045], to: 'foreArm.L', toAt: [0, -0.07, -0.035] },
    { name: 'armRod.L', from: 'foreArm.L', fromAt: [0, -0.07, -0.035], to: 'upperArm.L', toAt: [0, -0.1, -0.045] },
    { name: 'legPiston.L', from: 'thigh.L', fromAt: [0, -0.14, -0.06], to: 'shin.L', toAt: [0, -0.12, -0.06] },
    { name: 'legRod.L', from: 'shin.L', fromAt: [0, -0.12, -0.06], to: 'thigh.L', toAt: [0, -0.14, -0.06] },
  ]),
);
